import { z } from "zod";
import { ObjectId } from "bson";

// Keep ModelSize for backward compatibility, but allow any string
export type ModelSize = "small" | "medium" | "large" | string;

export const zModel = z.object({
  _id: z.instanceof(ObjectId),
  alias: z.string(), // Changed from enum to string to support any model alias
  name: z.string(),
  provider: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export type Model = z.infer<typeof zModel>;

export interface CreateModelData {
  alias: string; // Changed from ModelSize to string
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
}

export interface UpdateModelData {
  alias?: string; // Changed from ModelSize to string
  name?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}
