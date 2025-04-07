import { z } from "zod";
import { Redis } from "ioredis";
import { Queue } from "bullmq";

export const QUEUE_NAME = "foo";

export const JobDataSchema = z.object({
  foo: z.string().optional(),
  qux: z.string().optional(),
  bar: z.string().optional(),
});

export type JobData = z.infer<typeof JobDataSchema>;

export const connection = new Redis({ maxRetriesPerRequest: null });

export const queue = new Queue<JobData>(QUEUE_NAME, { connection });
