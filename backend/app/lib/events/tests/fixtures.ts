import { defineFixture } from "@/tests/fixtures.server.ts";
import { createClient } from "npm:redis@^4.7.0";
import { redis } from "@/lib/redis.ts";

defineFixture({
  token: "EventPublisher",
  dependencies: [],
  factory: async () => {
    const host = redis.options.host || "localhost";
    const port = redis.options.port || 6379;
    const password = redis.options.password;
    const url = password 
      ? `redis://:${password}@${host}:${port}`
      : `redis://${host}:${port}`;

    const subscriber = createClient({ url });

    const subscriber2 = createClient({ url });

    await subscriber.connect();
    await subscriber2.connect();

    return {
      subscriber,
      subscriber2,
    };
  },
  teardown: async ({ subscriber, subscriber2 }) => {
    await subscriber.quit();
    await subscriber2.quit();
  },
});
