import { z } from "zod";
import { ObjectId } from "bson";
import { zIcon } from "./icon";

export const zEventStyle = z.object({
  rightBorder: z.enum(["straight", "zigzag", "wave", "fade"]).optional(),
  thin: z.boolean().optional(),
}).strict().optional();

export const zEvent = z.object({
  _id: z.instanceof(ObjectId),
  kind: z.enum(["point", "range"]),
  title: z.string(),
  shortTitle: z.string().optional(),
  description: z.string().optional(),
  icon: zIcon,
  color: z.string(),
  category: z.string(),
  start: z.date(),
  end: z.date().optional(),
  parentId: z.string().optional(),
  titleWidth: z.number().optional(),
  shortTitleWidth: z.number().optional(),
  style: zEventStyle,
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

export type EventItem = z.infer<typeof zEvent>;
