import { defineFixture } from "@/tests/fixtures.server.ts";
import { createClient } from "npm:redis@^4.7.0";

defineFixture({
  token: "EventPublisher",
  dependencies: [],
  factory: async () => {
    const subscriber = createClient({
      url: Deno.env.get("REDIS_URL") || "redis://localhost:6379",
    });

    const subscriber2 = createClient({
      url: Deno.env.get("REDIS_URL") || "redis://localhost:6379",
    });

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
