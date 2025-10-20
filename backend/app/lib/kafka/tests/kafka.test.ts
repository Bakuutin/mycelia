import { expect } from "@std/expect";
import { Auth } from "@/lib/auth/core.server.ts";
import { getKafkaResource } from "../index.ts";
import { withFixtures } from "@/tests/fixtures.server.ts";

Deno.test(
  "should allow produce message",
  withFixtures([
    "Admin",
    "Kafka",
  ], async (auth: Auth) => {
    const kafka = await getKafkaResource(auth);
    await kafka({
      action: "produce",
      topic: "test-topic",
      messages: [{
        key: "test-key",
        value: "test-value",
        headers: { "test-header": "test-value" },
      }],
    });
  }),
);

Deno.test(
  "should allow consume messages",
  withFixtures([
    "Admin",
    "Kafka",
  ], async (auth: Auth) => {
    const kafka = await getKafkaResource(auth);

    await kafka({
      action: "produce",
      topic: "test-topic",
      messages: [{
        key: "test-key",
        value: "test-value",
        headers: { "test-header": "test-value" },
      }],
    });

    const messages: any[] = [];

    const result = await kafka({
      action: "consume",
      groupId: "test-group",
      topic: "test-topic",
      handler: async (message) => {
        messages.push(message);
      },
    });

    expect(result).toHaveProperty("consumer");
    expect(result.consumer).toBeDefined();
    await result.consumer.disconnect();
  }),
);

Deno.test(
  "should enforce policy: deny produce",
  withFixtures([
    "AuthFactory",
    "Kafka",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        { resource: "kafka/**", action: "produce", effect: "deny" },
        { resource: "kafka/**", action: "*", effect: "allow" },
      ],
    });
    const kafka = await getKafkaResource(auth);
    await expect(
      kafka({
        action: "produce",
        topic: "test-topic",
        messages: [{
          key: "test-key",
          value: "test-value",
        }],
      }),
    ).rejects.toHaveProperty("status", 403);
  }),
);

Deno.test(
  "should enforce policy: deny consume",
  withFixtures([
    "AuthFactory",
    "Kafka",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        { resource: "kafka/**", action: "consume", effect: "deny" },
        { resource: "kafka/**", action: "*", effect: "allow" },
      ],
    });
    const kafka = await getKafkaResource(auth);
    await expect(
      kafka({
        action: "consume",
        groupId: "test-group",
        topic: "test-topic",
        handler: async () => {},
      }),
    ).rejects.toHaveProperty("status", 403);
  }),
);

Deno.test(
  "should enforce policy: deny specific topic",
  withFixtures([
    "AuthFactory",
    "Kafka",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        {
          resource: "kafka/topic/restricted-topic",
          action: "*",
          effect: "deny",
        },
        { resource: "kafka/**", action: "*", effect: "allow" },
      ],
    });
    const kafka = await getKafkaResource(auth);
    await expect(
      kafka({
        action: "produce",
        topic: "restricted-topic",
        messages: [{
          key: "test-key",
          value: "test-value",
        }],
      }),
    ).rejects.toHaveProperty("status", 403);
  }),
);

Deno.test(
  "should enforce policy: deny specific consumer group",
  withFixtures([
    "AuthFactory",
    "Kafka",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        {
          resource: "kafka/group/restricted-group",
          action: "*",
          effect: "deny",
        },
        { resource: "kafka/**", action: "*", effect: "allow" },
      ],
    });
    const kafka = await getKafkaResource(auth);
    await expect(
      kafka({
        action: "consume",
        groupId: "restricted-group",
        topic: "test-topic",
        handler: async () => {},
      }),
    ).rejects.toHaveProperty("status", 403);
  }),
);

Deno.test(
  "should allow produce to allowed topic",
  withFixtures([
    "AuthFactory",
    "Kafka",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        {
          resource: "kafka/topic/allowed-topic",
          action: "produce",
          effect: "allow",
        },
      ],
    });
    const kafka = await getKafkaResource(auth);
    const result = await kafka({
      action: "produce",
      topic: "allowed-topic",
      messages: [{
        key: "test-key",
        value: "test-value",
      }],
    });
  }),
);

Deno.test(
  "should allow consume from allowed group",
  withFixtures([
    "AuthFactory",
    "Kafka",
  ], async (authFactory) => {
    const auth: Auth = authFactory({
      policies: [
        { resource: "kafka/group/allowed-group", action: "*", effect: "allow" },
        { resource: "kafka/topic/test-topic", action: "*", effect: "allow" },
      ],
    });
    const kafka = await getKafkaResource(auth);

    await kafka({
      action: "produce",
      topic: "test-topic",
      messages: [{
        key: "test-key",
        value: "test-value",
      }],
    });

    const result = await kafka({
      action: "consume",
      groupId: "allowed-group",
      topic: "test-topic",
      handler: async () => {},
    });
    expect(result.consumer).toBeDefined();
    await result.consumer.disconnect();
  }),
);

Deno.test(
  "should handle message with headers",
  withFixtures([
    "Admin",
    "Kafka",
  ], async (auth: Auth) => {
    const kafka = await getKafkaResource(auth);
    const result = await kafka({
      action: "produce",
      topic: "test-topic",
      messages: [{
        key: "test-key",
        value: "test-value",
        headers: {
          "content-type": "application/json",
          "user-id": "12345",
        },
      }],
    });
    // expect(result).toBeDefined();
  }),
);

Deno.test(
  "should handle message without headers",
  withFixtures([
    "Admin",
    "Kafka",
  ], async (auth: Auth) => {
    const kafka = await getKafkaResource(auth);
    const result = await kafka({
      action: "produce",
      topic: "test-topic",
      messages: [{
        key: "test-key",
        value: "test-value",
      }],
    });
    // expect(result).toBeDefined();
  }),
);
