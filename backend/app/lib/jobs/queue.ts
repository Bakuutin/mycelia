import { Job, Queue, Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { redis } from "@/lib/redis.ts";
import type { JobData, JobType, JobResult } from "./types.ts";

const queues = new Map<JobType, Queue<JobData>>();

function getQueueName(type: JobType): string {
  return `jobs-${type}`;
}

export function getQueue(type: JobType): Queue<JobData> {
  let queue = queues.get(type);
  if (!queue) {
    queue = new Queue<JobData>(getQueueName(type), {
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
    queues.set(type, queue);
  }
  return queue;
}

export async function enqueueJob(
  data: JobData,
  options?: {
    priority?: number;
    jobId?: string;
  },
): Promise<Job<JobData>> {
  const jobId = options?.jobId || new ObjectId().toString();
  const queue = getQueue(data.type);

  return queue.add(data.type, data, {
    priority: options?.priority,
    jobId,
  });
}

export async function getJob(
  type: JobType,
  jobId: string,
): Promise<Job<JobData> | null> {
  const queue = getQueue(type);
  const job = await queue.getJob(jobId);
  return job || null;
}

export function createWorker(
  type: JobType,
  processor: (job: Job<JobData>) => Promise<JobResult>,
): Worker<JobData, JobResult> {
  return new Worker<JobData, JobResult>(
    getQueueName(type),
    processor,
    {
      connection: redis,
      concurrency: 1,
    },
  );
}
