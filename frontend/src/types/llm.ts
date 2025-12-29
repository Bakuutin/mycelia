import { z } from "zod";
import { ObjectId } from "bson";

export type ModelSize = "small" | "medium" | "large";

export type ProviderType = "llm" | "transcription";

export const zProvider = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string(),
  type: z.enum(["llm", "transcription"]),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export type Provider = z.infer<typeof zProvider>;

export const zModel = z.object({
  _id: z.instanceof(ObjectId),
  alias: z.string(),
  name: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export type Model = z.infer<typeof zModel>;

export interface CreateProviderData {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
}

export interface UpdateProviderData {
  name?: string;
  type?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
}

export interface CreateModelData {
  alias: string;
  name: string;
}

export interface UpdateModelData {
  alias?: string;
  name?: string;
}
