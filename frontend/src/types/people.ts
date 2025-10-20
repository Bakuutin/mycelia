import { z } from "zod";
import { ObjectId } from "bson";
import { zIcon } from "./icon";

export const zPerson = z.object({
  _id: z.instanceof(ObjectId),
  name: z.string(),
  details: z.string().optional(),
  icon: zIcon,
  createdAt: z.date(),
  updatedAt: z.date(),
}).strict();

export type Person = z.infer<typeof zPerson>;
