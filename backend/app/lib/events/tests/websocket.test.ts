import { expect } from "@std/expect";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { publishJobUpdate, publishEvent } from "../publisher.ts";
import { redis } from "@/lib/redis.ts";
import "./fixtures.ts";

Deno.test(
  "publishEvent publishes message to Redis channel",
  withFixtures(["EventPublisher"], async ({ subscriber }) => {
    const messages: string[] = [];

    await subscriber.subscribe("mycelia:test:channel", (message: string) => {
      messages.push(message);
    });

    await publishEvent("test:channel", "test.event", { foo: "bar" });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages.length).toBe(1);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.event).toBe("test.event");
    expect(parsed.data.foo).toBe("bar");
    expect(parsed.timestamp).toBeDefined();
  })
);

Deno.test(
  "publishJobUpdate publishes to both specific and wildcard channels",
  withFixtures(["EventPublisher"], async ({ subscriber }) => {
    const specificMessages: string[] = [];
    const wildcardMessages: string[] = [];

    await subscriber.subscribe("mycelia:jobs:job123", (message: string) => {
      specificMessages.push(message);
    });

    await subscriber.subscribe("mycelia:jobs:*", (message: string) => {
      wildcardMessages.push(message);
    });

    await publishJobUpdate("job123", "vad", "job.progress", {
      state: "active",
      progress: { processed: 50, total: 100 },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(specificMessages.length).toBe(1);
    expect(wildcardMessages.length).toBe(1);

    const parsed = JSON.parse(specificMessages[0]);
    expect(parsed.event).toBe("job.progress");
    expect(parsed.data.jobId).toBe("job123");
    expect(parsed.data.jobType).toBe("vad");
    expect(parsed.data.state).toBe("active");
    expect(parsed.data.progress.processed).toBe(50);
  })
);

Deno.test(
  "publishJobUpdate includes all job data",
  withFixtures(["EventPublisher"], async ({ subscriber }) => {
    const messages: string[] = [];

    await subscriber.subscribe("mycelia:jobs:job456", (message: string) => {
      messages.push(message);
    });

    await publishJobUpdate("job456", "transcription", "job.completed", {
      state: "completed",
      result: { transcriptId: "abc123" },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages.length).toBe(1);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.event).toBe("job.completed");
    expect(parsed.data.jobId).toBe("job456");
    expect(parsed.data.jobType).toBe("transcription");
    expect(parsed.data.state).toBe("completed");
    expect(parsed.data.result.transcriptId).toBe("abc123");
  })
);

Deno.test(
  "publishEvent includes timestamp",
  withFixtures(["EventPublisher"], async ({ subscriber }) => {
    const messages: string[] = [];

    await subscriber.subscribe("mycelia:timeline:*", (message: string) => {
      messages.push(message);
    });

    const beforeTime = new Date().toISOString();
    await publishEvent("timeline:*", "timeline.invalidated", {
      start: "2024-01-01T00:00:00Z",
      end: "2024-01-02T00:00:00Z",
    });
    const afterTime = new Date().toISOString();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages.length).toBe(1);
    const parsed = JSON.parse(messages[0]);
    expect(parsed.timestamp).toBeDefined();
    expect(parsed.timestamp >= beforeTime).toBe(true);
    expect(parsed.timestamp <= afterTime).toBe(true);
  })
);

Deno.test(
  "multiple subscribers receive same message",
  withFixtures(["EventPublisher"], async ({ subscriber, subscriber2 }) => {
    const messages1: string[] = [];
    const messages2: string[] = [];

    await subscriber.subscribe("mycelia:objects:*", (message: string) => {
      messages1.push(message);
    });

    await subscriber2.subscribe("mycelia:objects:*", (message: string) => {
      messages2.push(message);
    });

    await publishEvent("objects:*", "object.created", {
      objectId: "obj123",
      object: { name: "Test Object" },
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(messages1.length).toBe(1);
    expect(messages2.length).toBe(1);
    expect(messages1[0]).toBe(messages2[0]);
  })
);
