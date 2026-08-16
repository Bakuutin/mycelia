// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  apiClient: {
    baseURL: "http://localhost:5173",
    getJWT: vi.fn().mockResolvedValue(null),
  },
}));

import { WebSocketClient } from "./websocket";

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) });
  }

  send(message: string): void {
    this.sent.push(message);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("WebSocket application readiness", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends subscriptions only after the server ready message", async () => {
    const client = new WebSocketClient();
    const callback = vi.fn();
    client.subscribe("jobs:*", callback);

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    socket.open();

    expect(client.isConnected).toBe(false);
    expect(socket.sent).toEqual([]);

    socket.receive({ type: "ready" });

    expect(client.isConnected).toBe(true);
    expect(socket.sent.map((message) => JSON.parse(message))).toEqual([
      { type: "subscribe", channel: "jobs:*" },
    ]);
    client.disconnect();
  });

  it("notifies global and channel listeners after a delivery gap", async () => {
    const client = new WebSocketClient();
    const eventListener = vi.fn();
    const resyncListener = vi.fn();
    client.onResync(resyncListener);
    client.subscribe("mongo:objects", eventListener);

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "ready" });
    socket.receive({
      type: "resync_required",
      reason: "redis_reconnected",
    });

    expect(resyncListener).toHaveBeenCalledWith("redis_reconnected");
    expect(eventListener).toHaveBeenCalledWith({
      channel: "mongo:objects",
      event: "resync_required",
      data: { reason: "redis_reconnected" },
    });
    client.disconnect();
  });

  it("resyncs canonical state only after a connection epoch is subscribed", async () => {
    const client = new WebSocketClient();
    const resyncListener = vi.fn();
    client.onResync(resyncListener);
    client.subscribe("jobs:*", vi.fn());

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "ready" });
    expect(resyncListener).not.toHaveBeenCalled();

    socket.receive({ type: "subscribed", channel: "jobs:*" });
    expect(resyncListener).toHaveBeenCalledWith("subscriptions_ready");
    client.disconnect();
  });

  it("resyncs after a channel is added to an already ready connection", async () => {
    const client = new WebSocketClient();
    const resyncListener = vi.fn();
    client.onResync(resyncListener);
    client.subscribe("jobs:*", vi.fn());

    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    socket.open();
    socket.receive({ type: "ready" });
    socket.receive({ type: "subscribed", channel: "jobs:*" });
    resyncListener.mockClear();

    client.subscribe("mongo:objects", vi.fn());
    expect(resyncListener).not.toHaveBeenCalled();
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: "subscribe",
      channel: "mongo:objects",
    });

    socket.receive({ type: "subscribed", channel: "mongo:objects" });
    expect(resyncListener).toHaveBeenCalledWith("subscriptions_ready");
    client.disconnect();
  });
});
