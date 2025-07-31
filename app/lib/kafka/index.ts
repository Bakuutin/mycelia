import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import {
  Kafka,
  KafkaConfig,
  SASLOptions,
  Partitioners,
} from "kafkajs";

import { Auth } from "@/lib/auth/index.ts";

export const KafkaMessageSchema = z.object({
  topic: z.string(),
  message: z.object({
    key: z.string(),
    value: z.string(),
    headers: z.record(z.string()).optional(),
  }),
});

export const KafkaConsumerMessageSchema = z.object({
  topic: z.string(),
  partition: z.number(),
  offset: z.string(),
  key: z.string().nullable(),
  value: z.string().nullable(),
  headers: z.record(z.string()).optional(),
});

export type KafkaMessage = z.infer<typeof KafkaMessageSchema>;
export type KafkaConsumerMessage = z.infer<typeof KafkaConsumerMessageSchema>;

const produceSchema = z.object({
  action: z.literal("produce"),
  topic: z.string(),
  messages: z.array(z.object({
    key: z.string(),
    value: z.string(),
    headers: z.record(z.string()).optional(),
  })),
});

const consumeSchema = z.object({
  groupId: z.string(),
  action: z.literal("consume"),
  topic: z.string(),
  handler: z.function().args(KafkaConsumerMessageSchema).returns(
    z.promise(z.void()),
  ),
});

const kafkaRequestSchema = z.discriminatedUnion("action", [
  produceSchema,
  consumeSchema,
]);

type KafkaRequest = z.infer<typeof kafkaRequestSchema>;
type KafkaResponse = any;

export class KafkaResource implements Resource<KafkaRequest, KafkaResponse> {
  code = "tech.mycelia.kafka";
  schemas = {
    request: kafkaRequestSchema,
    response: z.any(),
  };
  kafka: Kafka;

  constructor(config?: KafkaConfig | Kafka) {
    if (config instanceof Kafka) {
      this.kafka = config;
    } else {
      this.kafka = new Kafka(
        config || {
          clientId: "mycelia",
          brokers: [Deno.env.get("KAFKA_BROKER") || "localhost:9092"],
          connectionTimeout: 3000,
          authenticationTimeout: 1000,
          retry: {
            initialRetryTime: 100,
            retries: 8,
          },
          sasl: {
            mechanism: "plain",
            username: Deno.env.get("KAFKA_USERNAME") || "admin",
            password: Deno.env.get("KAFKA_PASSWORD"),
          } as SASLOptions,
        },
      );
    }
  }

  async produce(input: z.infer<typeof produceSchema>): Promise<KafkaResponse> {
    const producer = this.kafka.producer({
      allowAutoTopicCreation: true,
      transactionTimeout: 30000,
      createPartitioner: Partitioners.DefaultPartitioner,
    });
    try {
      await producer.connect();
      await producer.send({
        topic: input.topic,
        messages: input.messages,
      });
    } finally {
      await producer.transaction.name
      await producer.disconnect();
    }
  }

  async consume(input: z.infer<typeof consumeSchema>): Promise<KafkaResponse> {
    const consumer = this.kafka.consumer({
      groupId: input.groupId,
      allowAutoTopicCreation: true,
    });
    try {
      await consumer.connect();
      await consumer.subscribe({ topic: input.topic, fromBeginning: true });
      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const consumerMessage = KafkaConsumerMessageSchema.parse({
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString() || null,
            value: message.value?.toString() || null,
            headers: message.headers,
          });
          await input.handler(consumerMessage);
        },
      });
      return {
        consumer,
      };
    } catch (error) {
      await consumer?.disconnect();
      throw error;
    }
  }

  async use(input: KafkaRequest): Promise<KafkaResponse> {
    switch (input.action) {
      case "produce":
        return await this.produce(input);
      case "consume":
        return await this.consume(input);
      }
  }

  extractActions(input: KafkaRequest) {
    const paths = [{
      path: ["kafka", "topic", input.topic],
      actions: [input.action],
    }];

    if (input.action === "consume") {
      paths.push({
        path: ["kafka", "group", input.groupId],
        actions: [input.action],
      });
    }
    return paths;
  }
}

export function getKafkaResource(
  auth: Auth,
): Promise<(input: KafkaRequest) => Promise<KafkaResponse>> {
  return auth.getResource("tech.mycelia.kafka");
}
