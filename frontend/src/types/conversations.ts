import { z } from "zod";
import { ObjectId } from "bson";
import { zIcon } from "./icon";

export const zTimeRange = z.object({
  start: z.date(),
  end: z.date(),
});

export type TimeRange = z.infer<typeof zTimeRange>;

export const zParticipant = z.object({
  id: z.instanceof(ObjectId),
  name: z.string(),
});

export type Participant = z.infer<typeof zParticipant>;

export const zConversation = z.object({
  _id: z.instanceof(ObjectId),
  title: z.string().optional(),
  summary: z.string().optional(),
  entities: z.array(z.string()).default([]),
  icon: zIcon,
  timeRanges: z.array(zTimeRange),
  participants: z.array(zParticipant).default([]),
  shareLink: z.string().optional(),
  isShared: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

export type Conversation = z.infer<typeof zConversation>;
