import { z } from "zod";

import { zObjectId, zDateOrString } from "./zod-json-schema.ts";



export const zProviderConfig = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

// Deprecated: use llm and transcription instead
export const zInferenceProviderConfig = zProviderConfig;

export const zWorkerConfig = z.object({
  paused: z.boolean().optional().default(false).describe("Whether this worker is paused and won't process new jobs."),
});

export type WorkerConfig = z.infer<typeof zWorkerConfig>;

export const zServerConfigPrompts = z.object({
  chat_system: zObjectId().optional().nullable(),
  summarization_system: zObjectId().optional().nullable(),
}).optional();

export const zServerConfig = z.object({
  prompts: zServerConfigPrompts,
  llm: zProviderConfig.optional().nullable(),
  transcription: zProviderConfig.optional().nullable(),
  // Deprecated: kept for backward compatibility
  inference: zInferenceProviderConfig.optional().nullable(),
  features: z.object({
    enable_experimental_processing: z.boolean().describe("Enable experimental processing of conversations. This feature is currently in development and may not work as expected."),
  }),
  workers: z.record(z.string(), zWorkerConfig).optional().default({}).describe("Per-worker configuration. Key is worker code/type."),
  createdAt: zDateOrString(),
  updatedAt: zDateOrString(),
});

export type ServerConfig = z.infer<typeof zServerConfig>;

export const zPromptForm = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().optional(),
  text: z.string().min(1, "Prompt text is required"),
});

export type PromptFormData = z.infer<typeof zPromptForm>;

export const zPrompt = z.object({
  _id: zObjectId(),
  name: z.string(),
  text: z.string(),
  description: z.string().optional(),
});

export type Prompt = z.infer<typeof zPrompt>;

export const zWorkerEntry = z.object({
  _id: zObjectId(),
  name: z.string().describe("Worker name/type (e.g., 'summarization', 'transcription')"),
  discovered: z.boolean().describe("Whether this worker is currently discovered/available"),
  inputSchema: z.record(z.string(), z.any()).describe("JSON Schema for worker input"),
  outputSchema: z.record(z.string(), z.any()).describe("JSON Schema for worker output"),
  defaultOverrides: z.record(z.string(), z.any()).optional().describe("Runtime overrides for schema defaults"),
  lastSeen: z.date().describe("Last time this worker was discovered"),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WorkerEntry = z.infer<typeof zWorkerEntry>;
