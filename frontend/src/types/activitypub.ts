import { z } from "zod";
import { ObjectId } from "bson";

export const zAPObject = z.object({
  _id: z.instanceof(ObjectId).optional(),
  
  "@context": z.union([
    z.string(),
    z.array(z.string()),
    z.record(z.any()),
  ]),
  
  type: z.union([z.string(), z.array(z.string())]),
  
  id: z.string(),
  
  name: z.union([z.string(), z.record(z.string())]).optional(),
  summary: z.union([z.string(), z.record(z.string())]).optional(),
  content: z.union([z.string(), z.record(z.string())]).optional(),
  published: z.string().optional(),
  updated: z.string().optional(),
  
  attachment: z.array(z.any()).optional(),
  icon: z.any().optional(),
  image: z.any().optional(),
  
  attributedTo: z.union([
    z.string(),
    z.array(z.string()),
    z.any(),
    z.array(z.any()),
  ]).optional(),
  inReplyTo: z.union([
    z.string(),
    z.array(z.string()),
    z.any(),
    z.array(z.any()),
  ]).optional(),
  replies: z.union([z.string(), z.any()]).optional(),
  
  followers: z.union([z.string(), z.any()]).optional(),
  following: z.union([z.string(), z.any()]).optional(),
  likes: z.union([z.string(), z.any()]).optional(),
  shares: z.union([z.string(), z.any()]).optional(),
  
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  
  to: z.union([z.string(), z.array(z.string())]).optional(),
  cc: z.union([z.string(), z.array(z.string())]).optional(),
  bto: z.union([z.string(), z.array(z.string())]).optional(),
  bcc: z.union([z.string(), z.array(z.string())]).optional(),
  audience: z.union([z.string(), z.array(z.string())]).optional(),
  
  _internal: z.object({
    created: z.date(),
    updated: z.date(),
    localId: z.instanceof(ObjectId),
    indexed: z.boolean(),
  }).optional(),
});

export type APObject = z.infer<typeof zAPObject> & Record<string, any>;

export const zEdge = z.object({
  _id: z.instanceof(ObjectId).optional(),
  
  type: z.literal("Edge"),
  
  id: z.string(),
  
  subject: z.instanceof(ObjectId),
  object: z.instanceof(ObjectId),
  relationship: z.string(),
  
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  
  _internal: z.object({
    created: z.date(),
    updated: z.date(),
    symmetric: z.boolean().optional(),
  }).optional(),
});

export type Edge = z.infer<typeof zEdge> & Record<string, any>;

export const PREDICATES = {
  KNOWS: "foaf:knows",
  MEMBER_OF: "foaf:member",
  PARTICIPANT: "schema:participant",
  AUTHOR: "schema:author",
  ABOUT: "schema:about",
  MENTIONS: "schema:mentions",
  DURING: "temporal:during",
  BEFORE: "temporal:before",
  AFTER: "temporal:after",
  PARTICIPATED_IN: "mycelia:participatedIn",
  OCCURRED_DURING: "mycelia:occurredDuring",
  DERIVED_FROM: "mycelia:derivedFrom",
  RELATED_TO: "mycelia:relatedTo",
  HAS_TOPIC: "mycelia:hasTopic",
} as const;

export const OBJECT_TYPES = {
  PERSON: "Person",
  NOTE: "Note",
  AUDIO: "Audio",
  EVENT: "Event",
  PLACE: "Place",
  EDGE: "Edge",
} as const;


export function hasType(obj: APObject, type: string): boolean {
  const types = Array.isArray(obj.type) ? obj.type : [obj.type];
  return types.includes(type);
}

export function hasTypes(obj: APObject, types: string[]): boolean {
  const objectTypes = Array.isArray(obj.type) ? obj.type : [obj.type];
  return types.every(type => objectTypes.includes(type));
}

export function getProperty<T = any>(
  obj: APObject,
  key: string,
  defaultValue?: T
): T | undefined {
  return obj[key] ?? defaultValue;
}

export function isPersonObject(obj: APObject): boolean {
  return hasType(obj, "Person");
}

export function isNoteObject(obj: APObject): boolean {
  return hasType(obj, "Note");
}

export function isEventObject(obj: APObject): boolean {
  return hasType(obj, "Event");
}

export function getObjectName(obj: APObject): string {
  if (typeof obj.name === 'string') return obj.name;
  if (typeof obj.name === 'object' && obj.name !== null) {
    return obj.name.en || Object.values(obj.name)[0] || 'Untitled';
  }
  return 'Untitled';
}

export function getObjectTypes(obj: APObject): string[] {
  return Array.isArray(obj.type) ? obj.type : [obj.type];
}

