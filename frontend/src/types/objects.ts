import { z } from "zod";
import { ObjectId } from "bson";
import { zIcon } from "./icon";

export const zObject = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string(),
  details: z.string().optional(),
  icon: zIcon,
  aliases: z.array(z.string()).optional(),
  isEvent: z.boolean().optional(),
  isPerson: z.boolean().optional(),
  isRelationship: z.boolean().optional(),
  relationship: z.object({
    object: z.instanceof(ObjectId),
    subject: z.instanceof(ObjectId),
    symmetrical: z.boolean(),
  }).optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
  timeRanges: z.array(z.object({
    start: z.date(),
    end: z.date().optional(),
    name: z.string().optional(),
  })).optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

export type Object = z.infer<typeof zObject>;

