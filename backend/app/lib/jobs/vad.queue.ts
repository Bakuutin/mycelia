import { Job, Queue } from "bullmq";
import { ObjectId } from "mongodb";
import { redis } from "@/lib/redis.ts";
import type { VadJobData } from "./types.ts";

export const VAD_QUEUE_NAME = "vad";

export const vadQueue = new Queue<VadJobData>(VAD_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 500,
      age: 7 * 24 * 3600,
    },
  },
});

export async function enqueueVadJob(
  data: VadJobData,
  options?: {
    priority?: number;
    jobId?: string;
  },
): Promise<Job<VadJobData>> {
  const jobId = options?.jobId || new ObjectId().toString();

  return vadQueue.add("vad", data, {
    priority: options?.priority,
    jobId,
  });
}
