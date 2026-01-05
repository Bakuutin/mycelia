import { z } from "zod";
import { ObjectId } from "bson";

export const inferenceProviderTypeSchema = z.enum(["llm", "transcription"]);

export type InferenceProviderType = z.infer<typeof inferenceProviderTypeSchema>;

export const inferenceProviderSchema = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string(),
  type: inferenceProviderTypeSchema,
  baseUrl: z.string().url(),
  apiKey: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export type InferenceProvider = z.infer<typeof inferenceProviderSchema>;

export const llmModelSchema = z.object({
  _id: z.instanceof(ObjectId),
  alias: z.string(),
  name: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export type LLMModel = z.infer<typeof llmModelSchema>;

