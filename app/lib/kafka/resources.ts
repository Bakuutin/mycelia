import { z } from "zod";
import { Resource } from "@/lib/auth/resources.ts";
import { permissionDenied } from "@/lib/auth/utils.ts";
import { Auth } from "@/lib/auth/index.ts";
import {
  produceMessage, 
  consumeMessages,
  type KafkaMessage,
  type KafkaConsumerMessage 
} from "./core.ts";

const produceSchema = z.object({
  action: z.literal("produce"),
  topic: z.string(),
  message: z.object({
    key: z.string(),
    value: z.string(),
    headers: z.record(z.string()).optional(),
  }),
});

const consumeSchema = z.object({
  action: z.literal("consume"),
  topic: z.string(),
  handler: z.function(),
});

type KafkaHandler = (message: KafkaConsumerMessage) => Promise<void>;

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

  async produce(input: z.infer<typeof produceSchema>): Promise<KafkaResponse> {
    const kafkaMessage: KafkaMessage = {
      topic: input.topic,
      message: input.message,
    };
    return await produceMessage(kafkaMessage);
  }

  async consume(input: z.infer<typeof consumeSchema>): Promise<KafkaResponse> {
    return await consumeMessages(input.topic, input.handler as KafkaHandler);
  }

  async use(input: KafkaRequest, auth: Auth): Promise<KafkaResponse> {
    switch (input.action) {
      case "produce":
        return await this.produce(input);
      
      case "consume":
        return await this.consume(input);
      
      default:
        throw new Error("Unknown action");
    }
  }

  extractActions(input: KafkaRequest) {
    return [
      {
        path: ["kafka", input.topic],
        actions: [input.action],
      },
    ];
  }
}

export function getKafkaResource(
  auth: Auth,
): Promise<(input: KafkaRequest) => Promise<KafkaResponse>> {
  return auth.getResource("tech.mycelia.kafka");
} 