import { z } from "zod";
import { ObjectId } from "bson";

export type ModelSize = "small" | "medium" | "large";

export const zModel = z.object({
  _id: z.instanceof(ObjectId),
  alias: z.enum(["small", "medium", "large"]),
  name: z.string(),
  provider: z.string(),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
}).strict();

export type Model = z.infer<typeof zModel>;

export interface CreateModelData {
  alias: ModelSize;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
}

export interface UpdateModelData {
  alias?: ModelSize;
  name?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}
