import { z } from "zod";
import { ObjectId } from "bson";

const zObjectId = z.union([
  z.instanceof(ObjectId),
  z.any().refine((val) => ObjectId.isValid(val.toString()), {
    message: "Invalid ObjectId string",
  }).transform((val) => new ObjectId(val.toString())),
])


export const zPrompt = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string(),
  text: z.string(),
  description: z.string().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Prompt = z.infer<typeof zPrompt>;

const PROMPT_LABELS = {
  segmentation_system: "Find Conversation Topics",
  segmentation_guidance: "Topic Finder Response Format",
  summarization_system: "Analyze Conversation Details",
  summarization_guidance: "Analysis Response Format",
  chat_system: "Mycelia Assistant Personality",
} as const;

export const zServerConfigPrompts = z.object({
  segmentation_system: zObjectId.optional().nullable().describe("Breaks long transcripts into separate conversation topics. For example, a 2-hour recording might be split into 'Vacation Planning' (10:00-10:15), 'Work Discussion' (10:15-10:45), etc. Each topic gets a title and time range."),
  segmentation_guidance: zObjectId.optional().nullable().describe("Ensures the topic finder responds in the correct JSON format. Usually just tells the AI to return JSON only."),
  summarization_system: zObjectId.optional().nullable().describe("Analyzes each conversation topic to extract details: writes a summary, picks an emoji, finds people/things mentioned, and notes if they agreed on anything. Creates the actual conversation objects you see in your timeline."),
  summarization_guidance: zObjectId.optional().nullable().describe("Ensures the conversation analyzer responds in the correct JSON format. Usually just tells the AI to return JSON only."),
  chat_system: zObjectId.optional().nullable().describe("The personality and core instructions for the Mycelia chat assistant."),
});

export const PROMPT_TASK_LABELS = PROMPT_LABELS;

export const zInferenceProviderConfig = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
});

export const zServerConfig = z.object({
  prompts: zServerConfigPrompts,
  inference: zInferenceProviderConfig.optional().nullable(),
  features: z.object({
    enable_experimental_processing: z.boolean().describe("Enable experimental processing of conversations. This feature is currently in development and may not work as expected."),
  }),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type ServerConfig = z.infer<typeof zServerConfig>;

export const zPromptForm = z.object({
  name: z.string().min(1, "Name is required").max(100),
  description: z.string().optional(),
  text: z.string().min(1, "Prompt text is required"),
});

export type PromptFormData = z.infer<typeof zPromptForm>;

