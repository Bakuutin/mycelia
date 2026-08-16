/**
 * Production boundary around the npm `ws` implementation.
 *
 * Mycelia runs `ws` through Deno's Node compatibility layer. A peer can vanish
 * between a readyState check and the underlying TCP write, so transport writes
 * must be treated as asynchronous and fallible. The backend runtime is pinned
 * to a Deno release whose Node TCP implementation reports those failures back
 * through the ordinary `ws` callback/error boundary.
 */

export interface WebSocketPeer {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string | Uint8Array, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping?(
    data?: string | Uint8Array,
    mask?: boolean,
    callback?: (error?: Error) => void,
  ): void;
  on(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(
    event: string,
    listener: (...args: any[]) => void,
  ): unknown;
}

interface TrackedSocket {
  alive: boolean;
  label: string;
  onClose: () => void;
  onError: (error: Error) => void;
  onPong: () => void;
}

const OPEN = 1;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Network disconnects that make an individual socket unusable but are not an
 * application failure. */
export function isExpectedWebSocketDisconnect(error: unknown): boolean {
  if (error instanceof Deno.errors.BrokenPipe) return true;

  const code = errorCode(error);
  if (
    code === "EPIPE" ||
    code === "ECONNRESET" ||
    code === "ERR_STREAM_DESTROYED"
  ) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return message.includes("broken pipe") ||
    message.includes("write epipe") ||
    message.includes("connection reset by peer") ||
    message.includes("socket is closed") ||
    message.includes("socket has been destroyed");
}

function logUnexpectedTransportError(label: string, error: unknown): void {
  if (!isExpectedWebSocketDisconnect(error)) {
    console.error(`[WS] ${label} transport error:`, error);
  }
}

/** Destroy a failed transport without attempting another protocol write. */
export function terminateWebSocket(
  socket: WebSocketPeer,
  label: string,
): boolean {
  try {
    socket.terminate();
    return true;
  } catch (error) {
    logUnexpectedTransportError(label, error);
    return false;
  }
}

/**
 * Send with the `ws` completion callback so asynchronous socket failures do
 * not become unhandled errors. A failed transport is terminated immediately.
 */
export function sendWebSocket(
  socket: WebSocketPeer,
  data: string | Uint8Array,
  label: string,
): boolean {
  if (socket.readyState !== OPEN) return false;
  if ((socket.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
    console.warn(
      `[WS] ${label} exceeded ${MAX_BUFFERED_BYTES} buffered bytes; ` +
        "terminating slow consumer",
    );
    terminateWebSocket(socket, label);
    return false;
  }

  try {
    socket.send(data, (error?: Error) => {
      if (!error) return;
      logUnexpectedTransportError(label, error);
      terminateWebSocket(socket, label);
    });
    return true;
  } catch (error) {
    logUnexpectedTransportError(label, error);
    terminateWebSocket(socket, label);
    return false;
  }
}

/** Graceful close for healthy protocol paths (for example an auth rejection).
 * Error paths should call terminateWebSocket() instead. */
export function closeWebSocket(
  socket: WebSocketPeer,
  code: number,
  reason: string,
  label: string,
): boolean {
  if (socket.readyState !== OPEN) return false;

  try {
    socket.close(code, reason);
    return true;
  } catch (error) {
    logUnexpectedTransportError(label, error);
    terminateWebSocket(socket, label);
    return false;
  }
}

/**
 * Owns socket liveness and transport-level error handling for every upgraded
 * connection. Application sessions retain ownership of their domain cleanup.
 */
export class WebSocketSupervisor {
  private readonly sockets = new Map<WebSocketPeer, TrackedSocket>();
  private readonly emptyWaiters = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly heartbeatIntervalMs = 30_000) {}

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(
      () => this.checkConnections(),
      this.heartbeatIntervalMs,
    );
  }

  track(socket: WebSocketPeer, label: string): void {
    if (this.sockets.has(socket)) return;

    const tracked: TrackedSocket = {
      alive: true,
      label,
      onClose: () => this.untrack(socket),
      onError: (error: Error) => {
        logUnexpectedTransportError(label, error);
        this.untrack(socket);
        terminateWebSocket(socket, label);
      },
      onPong: () => {
        const state = this.sockets.get(socket);
        if (state) state.alive = true;
      },
    };

    this.sockets.set(socket, tracked);
    socket.on("pong", tracked.onPong);
    socket.on("close", tracked.onClose);
    socket.on("error", tracked.onError);
  }

  untrack(socket: WebSocketPeer): void {
    const tracked = this.sockets.get(socket);
    if (!tracked) return;
    this.sockets.delete(socket);

    const remove = socket.off?.bind(socket) ??
      socket.removeListener?.bind(socket);
    remove?.("pong", tracked.onPong);
    remove?.("close", tracked.onClose);
    remove?.("error", tracked.onError);

    if (this.sockets.size === 0) {
      for (const resolve of this.emptyWaiters) resolve();
      this.emptyWaiters.clear();
    }
  }

  fail(socket: WebSocketPeer, label: string, error: unknown): void {
    logUnexpectedTransportError(label, error);
    this.untrack(socket);
    terminateWebSocket(socket, label);
  }

  /** Public to allow deterministic liveness tests without sleeping. */
  checkConnections(): void {
    for (const [socket, tracked] of this.sockets) {
      if (!tracked.alive) {
        console.warn(
          `[WS] ${tracked.label} heartbeat timed out; terminating connection`,
        );
        this.untrack(socket);
        terminateWebSocket(socket, tracked.label);
        continue;
      }

      tracked.alive = false;
      if (!socket.ping) continue;

      try {
        socket.ping(undefined, false, (error?: Error) => {
          if (!error) return;
          logUnexpectedTransportError(tracked.label, error);
          this.untrack(socket);
          terminateWebSocket(socket, tracked.label);
        });
      } catch (error) {
        logUnexpectedTransportError(tracked.label, error);
        this.untrack(socket);
        terminateWebSocket(socket, tracked.label);
      }
    }
  }

  stop(options: { terminate?: boolean } = {}): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const socket of [...this.sockets.keys()]) {
      const label = this.sockets.get(socket)?.label ?? "connection";
      this.untrack(socket);
      if (options.terminate) terminateWebSocket(socket, label);
    }
  }

  /**
   * Stop accepting a permanently-open transport lifecycle gracefully, then
   * force-close only peers that did not acknowledge the shutdown deadline.
   */
  async shutdown(gracePeriodMs = 5_000): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }

    for (const [socket, tracked] of this.sockets) {
      closeWebSocket(socket, 1001, "Server shutting down", tracked.label);
    }

    if (this.sockets.size > 0) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.emptyWaiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, gracePeriodMs);
        this.emptyWaiters.add(finish);
      });
    }

    for (const socket of [...this.sockets.keys()]) {
      const label = this.sockets.get(socket)?.label ?? "connection";
      this.untrack(socket);
      terminateWebSocket(socket, label);
    }
  }
}
