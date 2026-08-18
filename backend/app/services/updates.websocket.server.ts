import type { IncomingMessage } from "node:http";
import type { WebSocket } from "npm:ws@^8.18.0";
import { authenticate } from "@/lib/auth/core.server.ts";
import { getQueue } from "@/lib/jobs/queue.ts";
import { jobRegistry } from "@/lib/jobs/job-registry.ts";
import {
  closeWebSocket,
  isExpectedWebSocketDisconnect,
  sendWebSocket,
  terminateWebSocket,
} from "@/lib/websocket-transport.ts";
import {
  type UpdatesPubSubEvent,
  UpdatesPubSubHub,
  updatesPubSubHub,
} from "@/services/updates-pubsub.server.ts";
import { chatUserChannel } from "@/lib/chat/events.server.ts";

export async function createRequestFromUpgrade(
  upgrade: IncomingMessage,
): Promise<Request> {
  const url = upgrade.url || "/";
  const headers = new Headers();

  for (const [key, value] of Object.entries(upgrade.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        headers.set(key, value.join(", "));
      } else {
        headers.set(key, value);
      }
    }
  }

  const protocol = "http";
  const host = upgrade.headers.host || "localhost";
  const urlObject = new URL(url, `${protocol}://${host}`);
  const token = urlObject.searchParams.get("token");

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return new Request(urlObject, {
    method: "GET",
    headers,
  });
}

interface ClientMessage {
  type: "subscribe" | "unsubscribe" | "ping";
  channel?: string;
}

interface ServerMessage {
  type:
    | "ready"
    | "subscribed"
    | "unsubscribed"
    | "event"
    | "resync_required"
    | "pong"
    | "error";
  channel?: string;
  event?: string;
  data?: unknown;
  message?: string;
  reason?: string;
}

type SessionState = "new" | "open" | "closing" | "closed";

export class UpdatesWebSocketSession {
  private readonly subscriptions = new Set<string>();
  private readonly subscriptionAliases = new Map<string, string>();
  private state: SessionState = "new";
  private initialization: Promise<void> | null = null;
  private commandTail: Promise<void> = Promise.resolve();
  private cleanupPromise: Promise<void> | null = null;
  private removeResyncListener: (() => void) | null = null;
  private resolveClosed: () => void = () => undefined;
  readonly closed: Promise<void>;

  private readonly handlePubSubEvent = (event: UpdatesPubSubEvent) => {
    if (this.state !== "open") return;

    try {
      const payload = JSON.parse(event.message);
      const clientChannel = [...this.subscriptionAliases.entries()].find(
        ([, serverChannel]) => serverChannel === event.channel,
      )?.[0] ?? event.channel;
      this.sendMessage({
        type: "event",
        channel: clientChannel,
        event: payload.event,
        data: payload.data,
      });
    } catch (error) {
      console.error(
        `[WS] Invalid Redis payload for ${event.channel}:`,
        error,
      );
    }
  };

  constructor(
    private readonly ws: WebSocket,
    private readonly hub: UpdatesPubSubHub = updatesPubSubHub,
    private readonly scopedChatChannel?: string,
  ) {
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  get isOpen(): boolean {
    return this.state === "open";
  }

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    this.initialization = this.initializeInternal();
    return this.initialization;
  }

  private async initializeInternal(): Promise<void> {
    await this.hub.start();
    if (this.state !== "new") return;

    this.removeResyncListener = this.hub.onResync(({ reason }) => {
      if (this.state !== "open") return;
      this.sendMessage({ type: "resync_required", reason });
    });
    this.state = "open";
    this.sendMessage({ type: "ready" });
  }

  /** Serializes all protocol commands from this browser session. */
  enqueueMessage(rawMessage: string): Promise<void> {
    const operation = this.commandTail.then(async () => {
      await this.initialize();
      if (this.state !== "open") return;
      await this.handleMessage(rawMessage);
    });

    this.commandTail = operation.catch((error) => {
      void this.fail(error);
    });
    return this.commandTail;
  }

  private async handleMessage(rawMessage: string): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(rawMessage);
    } catch {
      this.sendMessage({ type: "error", message: "Invalid message format" });
      return;
    }

    switch (message.type) {
      case "subscribe":
        if (!message.channel) {
          this.sendMessage({ type: "error", message: "Channel is required" });
          return;
        }
        if (!isValidChannel(message.channel)) {
          this.sendMessage({ type: "error", message: "Invalid channel name" });
          return;
        }
        if (
          message.channel.startsWith("chat:") &&
          message.channel !== "chat:self"
        ) {
          this.sendMessage({
            type: "error",
            message: "Chat channel is scoped",
          });
          return;
        }
        if (message.channel === "chat:self" && !this.scopedChatChannel) {
          this.sendMessage({
            type: "error",
            message: "Chat channel is unavailable",
          });
          return;
        }
        await this.subscribe(message.channel);
        return;

      case "unsubscribe":
        if (!message.channel) return;
        if (!isValidChannel(message.channel)) {
          this.sendMessage({ type: "error", message: "Invalid channel name" });
          return;
        }
        await this.unsubscribe(message.channel);
        return;

      case "ping":
        this.sendMessage({ type: "pong" });
        return;

      default:
        this.sendMessage({
          type: "error",
          message: `Unknown message type: ${
            (message as { type?: unknown }).type
          }`,
        });
    }
  }

  private async subscribe(channel: string): Promise<void> {
    if (this.subscriptions.has(channel)) {
      this.sendMessage({ type: "subscribed", channel });
      return;
    }

    const serverChannel = channel === "chat:self"
      ? this.scopedChatChannel!
      : channel;
    await this.hub.subscribe(serverChannel, this.handlePubSubEvent);
    this.subscriptions.add(channel);
    this.subscriptionAliases.set(channel, serverChannel);
    this.sendMessage({ type: "subscribed", channel });
    console.log(`[WS] Subscribed to channel: ${channel}`);

    if (channel.startsWith("jobs:") && channel !== "jobs:*") {
      await this.sendCurrentJobState(channel.slice("jobs:".length));
    }
  }

  private async unsubscribe(channel: string): Promise<void> {
    if (!this.subscriptions.has(channel)) return;

    const serverChannel = this.subscriptionAliases.get(channel) ?? channel;
    await this.hub.unsubscribe(serverChannel, this.handlePubSubEvent);
    this.subscriptions.delete(channel);
    this.subscriptionAliases.delete(channel);
    this.sendMessage({ type: "unsubscribed", channel });
    console.log(`[WS] Unsubscribed from channel: ${channel}`);
  }

  private async sendCurrentJobState(jobId: string): Promise<void> {
    try {
      for (const jobType of jobRegistry.getJobTypes()) {
        const queue = getQueue(jobType);
        const job = await queue.getJob(jobId);
        if (!job) continue;

        const state = await job.getState();
        this.sendMessage({
          type: "event",
          channel: `jobs:${jobId}`,
          event: `job.${state}`,
          data: {
            jobId: job.id,
            jobType,
            state,
            progress: job.progress,
            result: job.returnvalue,
            failedReason: job.failedReason,
          },
        });
        return;
      }
    } catch (error) {
      console.error(
        `[WS] Failed to fetch current state for job ${jobId}:`,
        error,
      );
    }
  }

  private sendMessage(message: ServerMessage): boolean {
    return sendWebSocket(this.ws, JSON.stringify(message), "/ws");
  }

  private async fail(error: unknown): Promise<void> {
    if (this.state === "closing" || this.state === "closed") return;
    if (!isExpectedWebSocketDisconnect(error)) {
      console.error("[WS] Updates session command failed:", error);
    }
    terminateWebSocket(this.ws, "/ws");
    await this.cleanup();
  }

  cleanup(): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPromise = this.cleanupInternal();
    return this.cleanupPromise;
  }

  private async cleanupInternal(): Promise<void> {
    if (this.state === "closed") return;
    this.state = "closing";

    try {
      // Let an already-running subscribe/unsubscribe settle before taking the
      // final subscription snapshot. Failures are handled by enqueueMessage().
      await this.commandTail;

      this.removeResyncListener?.();
      this.removeResyncListener = null;

      const subscriptions = [...this.subscriptions];
      this.subscriptions.clear();
      const results = await Promise.allSettled(
        subscriptions.map((channel) =>
          this.hub.unsubscribe(
            this.subscriptionAliases.get(channel) ?? channel,
            this.handlePubSubEvent,
          )
        ),
      );
      this.subscriptionAliases.clear();
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(
            "[WS] Failed to release updates subscription:",
            result.reason,
          );
        }
      }
    } finally {
      this.state = "closed";
      this.resolveClosed();
    }
  }
}

function isValidChannel(channel: string): boolean {
  return /^[a-zA-Z0-9._:*-]+$/.test(channel);
}

export async function handleUpdatesWebSocket(
  ws: WebSocket,
  request: IncomingMessage,
): Promise<void> {
  console.log("[WS] /ws connection attempt");

  const req = await createRequestFromUpgrade(request);
  const auth = await authenticate(req);
  if (!auth) {
    console.log("[WS] /ws authentication failed");
    closeWebSocket(ws, 1008, "Unauthorized", "/ws");
    return;
  }
  if (ws.readyState !== 1) return;

  const session = new UpdatesWebSocketSession(
    ws,
    updatesPubSubHub,
    await chatUserChannel(auth.principal),
  );

  const removeListeners = () => {
    ws.off("message", onMessage);
    ws.off("close", onClose);
    ws.off("error", onError);
  };
  const onMessage = (data: unknown) => {
    const rawMessage = data instanceof Uint8Array
      ? new TextDecoder().decode(data)
      : String(data);
    void session.enqueueMessage(rawMessage);
  };
  const onClose = () => {
    void session.cleanup();
  };
  const onError = (error: Error) => {
    if (!isExpectedWebSocketDisconnect(error)) {
      console.error("[WS] /ws socket error:", error);
    }
    void session.cleanup();
  };

  ws.on("message", onMessage);
  ws.on("close", onClose);
  ws.on("error", onError);

  try {
    await session.initialize();
    if (!session.isOpen) {
      await session.cleanup();
      return;
    }
    console.log("[WS] /ws application session ready");
    await session.closed;
  } catch (error) {
    console.error("[WS] /ws failed to initialize:", error);
    terminateWebSocket(ws, "/ws");
    await session.cleanup();
  } finally {
    removeListeners();
  }
}
