import { Consumer, Kafka, Producer, SASLOptions } from "npm:kafkajs";
import { z } from "zod";

const kafkaConfig = {
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
};

export const kafka = new Kafka(kafkaConfig);

export const producer: Producer = kafka.producer({
  allowAutoTopicCreation: true,
  transactionTimeout: 30000,
});

export const consumer: Consumer = kafka.consumer({
  groupId: "mycelia-group",
  allowAutoTopicCreation: true,
});

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

export async function produceMessage(message: KafkaMessage) {
  const validatedMessage = KafkaMessageSchema.parse(message);
  await producer.send({
    topic: validatedMessage.topic,
    messages: [{
      key: validatedMessage.message.key,
      value: validatedMessage.message.value,
      headers: validatedMessage.message.headers,
    }],
  });
}

export async function consumeMessages(
  topic: string,
  handler: (message: KafkaConsumerMessage) => Promise<void>,
) {
  await consumer.subscribe({ topic, fromBeginning: true });

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

      await handler(consumerMessage);
    },
  });
}
