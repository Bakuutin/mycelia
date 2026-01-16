import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { redis } from "@/lib/redis.ts";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import type { JobData, JobResult, EnqueueJobOptions } from "./types.ts";
export type { EnqueueJobOptions };
import { jobRegistry } from "./job-registry.ts";

const queues = new Map<string, Queue<JobData>>();
const queueEvents = new Map<string, QueueEvents>();

function getQueueName(type: string): string {
  return `jobs-${type}`;
}

export function getQueue(type: string): Queue<JobData> {
  let queue = queues.get(type);
  if (!queue) {
    queue = new Queue<JobData>(getQueueName(type), {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
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

export function getQueueEvents(type: string): QueueEvents {
  let events = queueEvents.get(type);
  if (!events) {
    events = new QueueEvents(getQueueName(type), {
      connection: redis,
    });
    queueEvents.set(type, events);
  }
  return events;
}

export async function enqueueJob(
  data: JobData,
  options?: EnqueueJobOptions,
  authOverride?: Auth,
): Promise<Job<JobData>> {
  const jobId = options?.jobId || new ObjectId().toString();
  const parsedData = jobRegistry.validateJobData(data);

  if (!parsedData.type) {
    throw new Error(`Job data is missing 'type' field after validation for job ID: ${jobId}. Check if the schema for this job type includes the 'type' field.`);
  }

  const queue = getQueue(parsedData.type);

  // Store in MongoDB
  const auth = authOverride || await getServerAuth();
  const mongo = await getMongoResource(auth);
  
  const trigger = options?.trigger || { type: "manual" };
  const triggerWithPrincipal = {
    ...trigger,
    principal: auth.principal,
  };

  await mongo({
    action: "insertOne",
    collection: "jobs",
    doc: {
      _id: new ObjectId(jobId),
      type: parsedData.type,
      data: parsedData,
      state: "waiting",
      attempts: 0,
      trigger: triggerWithPrincipal,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return queue.add(parsedData.type, parsedData, {
    priority: options?.priority,
    jobId,
  });
}

export async function getJob(
  type: string,
  jobId: string,
): Promise<Job<JobData> | null> {
  const queue = getQueue(type);
  const job = await queue.getJob(jobId);
  return job || null;
}

export function createWorker(
  type: string,
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
