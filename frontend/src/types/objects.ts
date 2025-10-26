import { z } from "zod";
import { ObjectId } from "bson";
import { zIcon } from "./icon";


const zCustomFieldPrimitive = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);


const zCustomFieldValue = z.union([
  zCustomFieldPrimitive,
  z.array(zCustomFieldPrimitive),
]);

export const zObject = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string().optional(),
  details: z.string().optional(),
  icon: zIcon,
  aliases: z.array(z.string()).optional(),
  isEvent: z.boolean().optional(),
  isPerson: z.boolean().optional(),
  isRelationship: z.boolean().optional(),
  isPromise: z.boolean().optional(),
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
}).passthrough().refine(
  (data) => {
    if (data.isPromise) {
      return data.isRelationship === true &&
             data.relationship !== undefined;
    }
    return true;
  },
  {
    message: "If isPromise is true, the object must be a relationship and have at least one time interval",
    path: ["isPromise"]
  }
);

export type Object = z.infer<typeof zObject>;

export type ObjectFormData = {
  _id?: ObjectId;
  name?: string;
  details?: string;
  icon?: { text: string } | { base64: string };
  aliases?: string[];
  isEvent?: boolean;
  isPerson?: boolean;
  isRelationship?: boolean;
  isPromise?: boolean;
  relationship?: {
    object?: ObjectId;
    subject?: ObjectId;
    symmetrical: boolean;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
  timeRanges?: Array<{
    start: Date;
    end?: Date;
    name?: string;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
};

export function validateObjectForSave(obj: ObjectFormData): { valid: boolean; error?: string } {
  if (!obj.name?.trim()) {
    return { valid: false, error: 'Name is required' };
  }

  if (obj.isRelationship && obj.relationship) {
    if (!obj.relationship.object || !obj.relationship.subject) {
      return { valid: false, error: 'Relationship must have both subject and object configured' };
    }
  }

  if (obj.isPromise) {
    if (!obj.isRelationship) {
      return { valid: false, error: 'Promise objects must be relationships' };
    }
    if (!obj.relationship?.object || !obj.relationship?.subject) {
      return { valid: false, error: 'Promise objects must have a relationship configured' };
    }
    if (!obj.timeRanges || obj.timeRanges.length === 0) {
      return { valid: false, error: 'Promise objects must have at least one time interval' };
    }
  }

  return { valid: true };
}

