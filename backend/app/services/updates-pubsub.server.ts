import { redis } from "@/lib/redis.ts";

export interface UpdatesRedisSubscriber {
  readonly status: string;
  connect(): Promise<unknown>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  disconnect(reconnect?: boolean): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(
    event: string,
    listener: (...args: any[]) => void,
  ): unknown;
}

export interface UpdatesPubSubEvent {
  channel: string;
  message: string;
}

export interface UpdatesPubSubResync {
  reason: "redis_reconnected";
}

export type UpdatesPubSubListener = (
  event: UpdatesPubSubEvent,
) => void | Promise<void>;
export type UpdatesPubSubResyncListener = (
  event: UpdatesPubSubResync,
) => void | Promise<void>;
export type UpdatesPubSubReadinessListener = (ready: boolean) => void;

interface HubLogger {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

interface OperationalWaiter {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout> | null;
}

const CHANNEL_PREFIX = "mycelia:";

function redisChannel(channel: string): string {
  return `${CHANNEL_PREFIX}${channel}`;
}

function applicationChannel(channel: string): string {
  return channel.startsWith(CHANNEL_PREFIX)
    ? channel.slice(CHANNEL_PREFIX.length)
    : channel;
}

/**
 * One process-scoped Redis Pub/Sub transport for all browser WebSockets.
 *
 * WebSocket sessions only own local listeners. Redis subscriptions are
 * reference-counted and reconciled serially, so concurrent browser churn can
 * never race Redis's ready check or create one Redis connection per tab.
 */
export class UpdatesPubSubHub {
  private readonly listeners = new Map<string, Set<UpdatesPubSubListener>>();
  private readonly resyncListeners = new Set<UpdatesPubSubResyncListener>();
  private readonly readinessListeners = new Set<
    UpdatesPubSubReadinessListener
  >();
  private readonly activeChannels = new Set<string>();
  private operationTail: Promise<void> = Promise.resolve();
  private startPromise: Promise<void> | null = null;
  private started = false;
  private transportReady = false;
  private subscriptionsReady = false;
  private hasBeenReady = false;
  private deliveryGap = false;
  private recoveryGeneration = 0;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly operationalWaiters = new Set<OperationalWaiter>();

  private readonly onMessage = (channel: string, message: string) => {
    const cleanChannel = applicationChannel(channel);
    const channelListeners = this.listeners.get(cleanChannel);
    if (!channelListeners) return;

    for (const listener of [...channelListeners]) {
      Promise.resolve(listener({ channel: cleanChannel, message })).catch(
        (error) => {
          this.logger.error(
            `[UPDATES-HUB] Listener failed for ${cleanChannel}:`,
            error,
          );
        },
      );
    }
  };

  private readonly onError = (error: unknown) => {
    this.logger.error("[UPDATES-HUB] Redis subscriber error:", error);
  };

  private readonly onDisconnected = () => {
    if (this.transportReady || this.hasBeenReady) this.deliveryGap = true;
    this.transportReady = false;
    this.subscriptionsReady = false;
    this.notifyReadiness(false);
    this.recoveryGeneration++;
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.activeChannels.clear();
  };

  private readonly onReady = () => {
    this.transportReady = true;
    this.subscriptionsReady = false;
    this.notifyReadiness(false);
    const generation = ++this.recoveryGeneration;
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    void this.enqueue(() => this.restoreSubscriptions(generation, 0));
  };

  constructor(
    private readonly subscriber: UpdatesRedisSubscriber,
    private readonly logger: HubLogger = console,
    private readonly recoveryDelayMs: (attempt: number) => number = (attempt) =>
      Math.min(250 * 2 ** attempt, 5_000),
  ) {
    // Register an error listener before connect(); ioredis otherwise treats an
    // early connection error as an unhandled EventEmitter error.
    subscriber.on("error", this.onError);
    subscriber.on("message", this.onMessage);
    subscriber.on("ready", this.onReady);
    subscriber.on("close", this.onDisconnected);
    subscriber.on("end", this.onDisconnected);
    subscriber.on("reconnecting", this.onDisconnected);
  }

  get isReady(): boolean {
    return this.transportReady && this.subscriptionsReady &&
      this.subscriber.status === "ready";
  }

  get channelCount(): number {
    return this.listeners.size;
  }

  listenerCount(channel: string): number {
    return this.listeners.get(channel)?.size ?? 0;
  }

  /** Resolves after all queued Redis subscription changes have settled. */
  whenIdle(): Promise<void> {
    return this.operationTail;
  }

  start(): Promise<void> {
    if (!this.startPromise) {
      this.started = true;
      this.startPromise = this.startInternal().catch((error) => {
        this.started = false;
        this.startPromise = null;
        throw error;
      });
    }

    return this.startPromise.then(async () => {
      // The initial start promise stays fulfilled across ioredis reconnects.
      // A new WebSocket session must still wait for the current transport to
      // recover before receiving its application-level `ready` message.
      if (!this.isReady) await this.waitUntilOperational();
    });
  }

  private async startInternal(): Promise<void> {
    if (
      this.subscriber.status === "wait" ||
      this.subscriber.status === "end"
    ) {
      await this.subscriber.connect();
    } else if (this.subscriber.status !== "ready") {
      await this.waitForReady();
    }

    // Some fakes and alternative clients do not emit `ready` before connect()
    // resolves. The production ioredis client does, but keeping this explicit
    // makes the lifecycle contract deterministic.
    if (!this.transportReady) this.onReady();
    await this.operationTail;

    if (!this.isReady) {
      throw new Error("Updates Redis subscriber did not become ready");
    }
    this.logger.log("[UPDATES-HUB] Redis Pub/Sub ready");
  }

  private waitForReady(timeoutMs = 15_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const remove = this.subscriber.off?.bind(this.subscriber) ??
          this.subscriber.removeListener?.bind(this.subscriber);
        remove?.("ready", handleReady);
        remove?.("end", handleEnd);
        if (error) reject(error);
        else resolve();
      };
      const handleReady = () => finish();
      const handleEnd = () =>
        finish(new Error("Updates Redis subscriber ended before ready"));
      const timer = setTimeout(
        () =>
          finish(new Error("Timed out waiting for updates Redis subscriber")),
        timeoutMs,
      );

      this.subscriber.on("ready", handleReady);
      this.subscriber.on("end", handleEnd);
    });
  }

  private waitUntilOperational(timeoutMs = 15_000): Promise<void> {
    if (this.isReady) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const waiter: OperationalWaiter = {
        resolve: () => {
          if (waiter.timer !== null) clearTimeout(waiter.timer);
          this.operationalWaiters.delete(waiter);
          resolve();
        },
        reject: (error) => {
          if (waiter.timer !== null) clearTimeout(waiter.timer);
          this.operationalWaiters.delete(waiter);
          reject(error);
        },
        timer: null,
      };
      waiter.timer = setTimeout(
        () =>
          waiter.reject(
            new Error("Timed out waiting for updates Pub/Sub reconciliation"),
          ),
        timeoutMs,
      );
      this.operationalWaiters.add(waiter);
    });
  }

  async subscribe(
    channel: string,
    listener: UpdatesPubSubListener,
  ): Promise<void> {
    await this.start();

    await this.enqueue(async () => {
      if (!this.isReady) {
        throw new Error("Updates Redis subscriber is not ready");
      }

      let channelListeners = this.listeners.get(channel);
      if (!channelListeners) {
        channelListeners = new Set();
        this.listeners.set(channel, channelListeners);
      }

      if (channelListeners.has(listener)) return;
      channelListeners.add(listener);

      try {
        await this.reconcileChannel(channel);
      } catch (error) {
        channelListeners.delete(listener);
        if (channelListeners.size === 0) this.listeners.delete(channel);
        throw error;
      }
    });
  }

  async unsubscribe(
    channel: string,
    listener: UpdatesPubSubListener,
  ): Promise<void> {
    await this.enqueue(async () => {
      const channelListeners = this.listeners.get(channel);
      if (!channelListeners?.delete(listener)) return;

      if (channelListeners.size > 0) return;
      this.listeners.delete(channel);

      if (this.transportReady && this.activeChannels.has(channel)) {
        try {
          await this.subscriber.unsubscribe(redisChannel(channel));
        } finally {
          // A failed unsubscribe must not pin stale local state. Redis
          // SUBSCRIBE is idempotent if this channel is requested again.
          this.activeChannels.delete(channel);
        }
      } else {
        this.activeChannels.delete(channel);
      }
    });
  }

  onResync(listener: UpdatesPubSubResyncListener): () => void {
    this.resyncListeners.add(listener);
    return () => this.resyncListeners.delete(listener);
  }

  onReadinessChange(listener: UpdatesPubSubReadinessListener): () => void {
    this.readinessListeners.add(listener);
    listener(this.isReady);
    return () => this.readinessListeners.delete(listener);
  }

  private async reconcileAll(): Promise<void> {
    if (!this.transportReady) return;
    for (const channel of this.listeners.keys()) {
      await this.reconcileChannel(channel);
    }
  }

  private async reconcileChannel(channel: string): Promise<void> {
    if (!this.transportReady || this.activeChannels.has(channel)) return;
    if ((this.listeners.get(channel)?.size ?? 0) === 0) return;

    await this.subscriber.subscribe(redisChannel(channel));
    this.activeChannels.add(channel);
  }

  private async restoreSubscriptions(
    generation: number,
    attempt: number,
  ): Promise<void> {
    if (
      !this.started || !this.transportReady ||
      generation !== this.recoveryGeneration
    ) {
      return;
    }

    try {
      await this.reconcileAll();
      if (
        !this.transportReady || generation !== this.recoveryGeneration
      ) {
        return;
      }

      const needsResync = this.hasBeenReady && this.deliveryGap;
      this.subscriptionsReady = true;
      this.hasBeenReady = true;
      this.deliveryGap = false;
      this.notifyReadiness(true);
      for (const waiter of [...this.operationalWaiters]) waiter.resolve();
      if (needsResync) this.notifyResync();
    } catch (error) {
      this.subscriptionsReady = false;
      this.notifyReadiness(false);
      if (this.hasBeenReady) this.deliveryGap = true;
      this.logger.error(
        `[UPDATES-HUB] Redis subscription reconciliation failed ` +
          `(attempt ${attempt + 1}):`,
        error,
      );
      this.scheduleRecovery(generation, attempt + 1);
    }
  }

  private scheduleRecovery(generation: number, attempt: number): void {
    if (
      !this.started || !this.transportReady ||
      generation !== this.recoveryGeneration || this.recoveryTimer !== null
    ) {
      return;
    }

    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.enqueue(() => this.restoreSubscriptions(generation, attempt));
    }, this.recoveryDelayMs(attempt));
  }

  private notifyResync(): void {
    this.logger.warn(
      "[UPDATES-HUB] Redis delivery resumed; clients must resync canonical state",
    );
    for (const listener of [...this.resyncListeners]) {
      Promise.resolve(listener({ reason: "redis_reconnected" })).catch(
        (error) =>
          this.logger.error("[UPDATES-HUB] Resync listener failed:", error),
      );
    }
  }

  private notifyReadiness(ready: boolean): void {
    for (const listener of [...this.readinessListeners]) {
      try {
        listener(ready);
      } catch (error) {
        this.logger.error("[UPDATES-HUB] Readiness listener failed:", error);
      }
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.catch(() => undefined);
    return result;
  }

  stop(): void {
    this.started = false;
    this.startPromise = null;
    this.operationTail = Promise.resolve();
    this.transportReady = false;
    this.subscriptionsReady = false;
    this.hasBeenReady = false;
    this.deliveryGap = false;
    this.notifyReadiness(false);
    this.recoveryGeneration++;
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    for (const waiter of [...this.operationalWaiters]) {
      waiter.reject(new Error("Updates Pub/Sub hub stopped"));
    }
    this.activeChannels.clear();
    this.listeners.clear();
    this.resyncListeners.clear();
    this.readinessListeners.clear();
    this.subscriber.disconnect(false);
  }
}

function createUpdatesSubscriber(): UpdatesRedisSubscriber {
  return redis.duplicate({
    connectionName: "mycelia-updates-pubsub",
    lazyConnect: true,
    enableReadyCheck: true,
    enableOfflineQueue: false,
    autoResubscribe: false,
    autoResendUnfulfilledCommands: false,
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt: number) =>
      Math.min(attempt * 250, 5_000) + Math.floor(Math.random() * 250),
  }) as unknown as UpdatesRedisSubscriber;
}

export const updatesPubSubHub = new UpdatesPubSubHub(
  createUpdatesSubscriber(),
);
