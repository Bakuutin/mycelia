import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import { assertEquals, assertStrictEquals } from "jsr:@std/assert@^1.0.14";
import { expect } from "@std/expect";
import type { WebSocket } from "npm:ws@^8.18.0";
import { getAuthorizationHeader } from "@/lib/auth/core.server.ts";
import {
  createRequestFromUpgrade,
  UpdatesWebSocketSession,
} from "./updates.websocket.server.ts";
import {
  UpdatesPubSubHub,
  type UpdatesRedisSubscriber,
} from "./updates-pubsub.server.ts";

class DeferredRedisSubscriber extends EventEmitter
  implements UpdatesRedisSubscriber {
  status = "wait";
  subscribeCalls: string[][] = [];
  unsubscribeCalls: string[][] = [];
  private resolveConnection: (() => void) | null = null;

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveConnection = resolve;
    });
  }

  becomeReady(): void {
    this.status = "ready";
    this.emit("ready");
    this.resolveConnection?.();
  }

  subscribe(...channels: string[]): Promise<number> {
    this.subscribeCalls.push(channels);
    return Promise.resolve(this.subscribeCalls.length);
  }

  unsubscribe(...channels: string[]): Promise<number> {
    this.unsubscribeCalls.push(channels);
    return Promise.resolve(this.unsubscribeCalls.length);
  }

  disconnect(): void {
    this.status = "end";
  }
}

class FakeWebSocket extends EventEmitter {
  readyState = 1;
  sent: Array<Record<string, unknown>> = [];
  terminateCalls = 0;

  send(data: string, callback?: (error?: Error) => void): void {
    this.sent.push(JSON.parse(data));
    callback?.();
  }

  close(): void {
    this.readyState = 3;
  }

  terminate(): void {
    this.terminateCalls++;
    this.readyState = 3;
  }
}

const quietLogger = {
  log: (..._args: unknown[]) => undefined,
  warn: (..._args: unknown[]) => undefined,
  error: (..._args: unknown[]) => undefined,
};

function upgradeRequest(
  url: string,
  headers: Record<string, string> = {},
): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:5173", ...headers },
  } as IncomingMessage;
}

Deno.test("updates websocket accepts JWT from the token query parameter", async () => {
  const request = await createRequestFromUpgrade(
    upgradeRequest("/ws?token=signed-jwt"),
  );

  expect(request.headers.get("Authorization")).toBe("Bearer signed-jwt");
  expect(getAuthorizationHeader(request)).toBe("Bearer signed-jwt");
});

Deno.test("updates websocket preserves an Authorization header", async () => {
  const request = await createRequestFromUpgrade(
    upgradeRequest("/ws?token=query-jwt", {
      authorization: "Bearer header-jwt",
    }),
  );

  expect(request.headers.get("Authorization")).toBe("Bearer header-jwt");
});

Deno.test("updates session queues subscribe until Redis application readiness", async () => {
  const redis = new DeferredRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);
  const socket = new FakeWebSocket();
  const session = new UpdatesWebSocketSession(
    socket as unknown as WebSocket,
    hub,
  );

  const initialization = session.initialize();
  const subscription = session.enqueueMessage(JSON.stringify({
    type: "subscribe",
    channel: "mongo:objects",
  }));
  await Promise.resolve();

  assertEquals(redis.subscribeCalls, []);
  assertEquals(socket.sent, []);

  redis.becomeReady();
  await initialization;
  await subscription;

  assertEquals(redis.subscribeCalls, [["mycelia:mongo:objects"]]);
  assertEquals(socket.sent.map((message) => message.type), [
    "ready",
    "subscribed",
  ]);

  await session.cleanup();
  hub.stop();
});

Deno.test("updates session cleanup is idempotent under concurrent close paths", async () => {
  const redis = new DeferredRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);
  const socket = new FakeWebSocket();
  const session = new UpdatesWebSocketSession(
    socket as unknown as WebSocket,
    hub,
  );

  const initialization = session.initialize();
  redis.becomeReady();
  await initialization;
  await session.enqueueMessage(JSON.stringify({
    type: "subscribe",
    channel: "jobs:*",
  }));

  const firstCleanup = session.cleanup();
  const secondCleanup = session.cleanup();
  assertStrictEquals(firstCleanup, secondCleanup);
  await Promise.all([firstCleanup, secondCleanup]);

  assertEquals(redis.unsubscribeCalls, [["mycelia:jobs:*"]]);
  assertEquals(hub.listenerCount("jobs:*"), 0);
  hub.stop();
});
