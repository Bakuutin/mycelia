import { EventEmitter } from "node:events";
import { assertEquals } from "jsr:@std/assert@^1.0.14";
import {
  type UpdatesPubSubEvent,
  UpdatesPubSubHub,
  type UpdatesRedisSubscriber,
} from "./updates-pubsub.server.ts";

class FakeRedisSubscriber extends EventEmitter
  implements UpdatesRedisSubscriber {
  status = "wait";
  connectCalls = 0;
  subscribeCalls: string[][] = [];
  unsubscribeCalls: string[][] = [];
  disconnectCalls = 0;
  subscribeFailures = 0;

  connect(): Promise<void> {
    this.connectCalls++;
    this.status = "ready";
    this.emit("ready");
    return Promise.resolve();
  }

  subscribe(...channels: string[]): Promise<number> {
    this.subscribeCalls.push(channels);
    if (this.subscribeFailures > 0) {
      this.subscribeFailures--;
      return Promise.reject(new Error("temporary subscribe failure"));
    }
    return Promise.resolve(this.subscribeCalls.length);
  }

  unsubscribe(...channels: string[]): Promise<number> {
    this.unsubscribeCalls.push(channels);
    return Promise.resolve(this.unsubscribeCalls.length);
  }

  disconnect(): void {
    this.disconnectCalls++;
    this.status = "end";
  }

  loseConnection(): void {
    this.status = "reconnecting";
    this.emit("close");
    this.emit("reconnecting");
  }

  restoreConnection(): void {
    this.status = "ready";
    this.emit("ready");
  }

  publish(channel: string, message: string): void {
    this.emit("message", channel, message);
  }
}

const quietLogger = {
  log: (..._args: unknown[]) => undefined,
  warn: (..._args: unknown[]) => undefined,
  error: (..._args: unknown[]) => undefined,
};

Deno.test("updates hub starts Redis before the first subscription", async () => {
  const redis = new FakeRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);

  await hub.subscribe("jobs:*", () => undefined);

  assertEquals(redis.connectCalls, 1);
  assertEquals(redis.subscribeCalls, [["mycelia:jobs:*"]]);
  assertEquals(hub.listenerCount("jobs:*"), 1);
  hub.stop();
});

Deno.test("updates hub can restart after an intentional stop", async () => {
  const redis = new FakeRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);

  await hub.start();
  hub.stop();
  await hub.start();

  assertEquals(redis.connectCalls, 2);
  assertEquals(hub.isReady, true);
  hub.stop();
});

Deno.test("updates hub reference-counts shared Redis channels", async () => {
  const redis = new FakeRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);
  const first = () => undefined;
  const second = () => undefined;

  await Promise.all([
    hub.subscribe("mongo:objects", first),
    hub.subscribe("mongo:objects", second),
  ]);
  assertEquals(redis.subscribeCalls, [["mycelia:mongo:objects"]]);
  assertEquals(hub.listenerCount("mongo:objects"), 2);

  await hub.unsubscribe("mongo:objects", first);
  assertEquals(redis.unsubscribeCalls, []);
  assertEquals(hub.listenerCount("mongo:objects"), 1);

  await hub.unsubscribe("mongo:objects", second);
  assertEquals(redis.unsubscribeCalls, [["mycelia:mongo:objects"]]);
  assertEquals(hub.listenerCount("mongo:objects"), 0);
  hub.stop();
});

Deno.test("updates hub restores desired channels and reports a delivery gap", async () => {
  const redis = new FakeRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);
  const received: UpdatesPubSubEvent[] = [];
  const resyncReasons: string[] = [];

  await hub.subscribe("timeline:*", (event) => {
    received.push(event);
  });
  hub.onResync(({ reason }) => {
    resyncReasons.push(reason);
  });

  redis.loseConnection();
  redis.restoreConnection();
  await hub.whenIdle();
  await Promise.resolve();

  assertEquals(redis.subscribeCalls, [
    ["mycelia:timeline:*"],
    ["mycelia:timeline:*"],
  ]);
  assertEquals(resyncReasons, ["redis_reconnected"]);

  redis.publish(
    "mycelia:timeline:*",
    JSON.stringify({ event: "timeline.invalidated" }),
  );
  await Promise.resolve();
  assertEquals(received, [{
    channel: "timeline:*",
    message: JSON.stringify({ event: "timeline.invalidated" }),
  }]);
  hub.stop();
});

Deno.test("updates hub does not report ready to new sessions while reconnecting", async () => {
  const redis = new FakeRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger);
  await hub.start();

  redis.loseConnection();
  let recovered = false;
  const readiness = hub.start().then(() => {
    recovered = true;
  });
  await Promise.resolve();
  assertEquals(recovered, false);

  redis.restoreConnection();
  await readiness;
  assertEquals(recovered, true);
  hub.stop();
});

Deno.test("updates hub retries failed reconnect reconciliation before ready", async () => {
  const redis = new FakeRedisSubscriber();
  const hub = new UpdatesPubSubHub(redis, quietLogger, () => 0);
  await hub.subscribe("mongo:objects", () => undefined);

  redis.loseConnection();
  redis.subscribeFailures = 1;
  redis.restoreConnection();
  const readiness = hub.start();
  await readiness;

  assertEquals(redis.subscribeCalls, [
    ["mycelia:mongo:objects"],
    ["mycelia:mongo:objects"],
    ["mycelia:mongo:objects"],
  ]);
  assertEquals(hub.isReady, true);
  hub.stop();
});
