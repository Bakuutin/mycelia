import type { Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { createWorker, getQueueEvents, enqueueJob } from "./queue.ts";
import { processJob } from "./processor.ts";
import { jobRegistry, discoverJobWorkers } from "./job-registry.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { workerPauseManager } from "./worker-pause-manager.ts";
import { env } from "#/env.ts";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

const workers: Worker[] = [];

type FailedType = "offline" | "internal" | undefined;

/**
 * Classify error type to distinguish between:
 * - "offline": External/internet errors (DNS, external API unreachable)
 * - "internal": Internal service errors (backend/mongo connection refused)
 * - undefined: Other errors
 */
function classifyError(reason: string | undefined): FailedType {
  if (!reason) return undefined;
  const lower = reason.toLowerCase();

  // Internal service patterns (Docker internal network)
  const internalPatterns = [
    "backend:5173",
    "localhost:",
    "mongo:",
    "redis:",
    "127.0.0.1",
    "python-worker:",
  ];
  const isInternal = internalPatterns.some(p => lower.includes(p));

  // Connection error patterns
  const connectionPatterns = [
    "connection refused",
    "econnrefused",
  ];
  const isConnectionError = connectionPatterns.some(p => lower.includes(p));

  // If connection refused to internal service, it's an internal error
  if (isConnectionError && isInternal) {
    return "internal";
  }

  // External/offline error patterns
  const offlinePatterns = [
    "dns error",
    "name or service not known",
    "enetunreach",
    "ehostunreach",
    "getaddrinfo",
  ];
  if (offlinePatterns.some(p => lower.includes(p))) {
    return "offline";
  }

  // Connection refused to external service = offline
  if (isConnectionError && !isInternal) {
    return "offline";
  }

  return undefined;
}

export async function startWorkers() {
  console.log("Starting job workers...");

  // Discover and register all job workers
  await discoverJobWorkers();

  const jobTypes = jobRegistry.getJobTypes();

  for (const jobType of jobTypes) {
    const worker = createWorker(jobType, processJob);

    // Global events listener to ensure MongoDB is in sync with BullMQ
    // This catches events even from other worker instances (like Python workers)
    const events = getQueueEvents(jobType);

    events.on("active", async ({ jobId, prev }) => {
      console.log(`[${jobType}] Job ${jobId} is now active (prev: ${prev})`);
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);
      const startedAt = new Date();
      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId) },
        update: { 
          $set: { 
            state: "active", 
            startedAt,
            updatedAt: new Date() 
          },
          $inc: { attempts: 1 }
        },
      });

      await publishJobUpdate(jobId, jobType, "job.active", {
        state: "active",
        processedOn: startedAt.getTime(),
      });
    });

    events.on("completed", async ({ jobId, returnvalue }) => {
      console.log(`[${jobType}] Job ${jobId} completed globally`);
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);
      const finishedAt = new Date();
      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId) },
        update: { 
          $set: { 
            state: "completed", 
            finishedAt,
            result: returnvalue,
            updatedAt: new Date() 
          } 
        },
      });

      await publishJobUpdate(jobId, jobType, "job.completed", {
        state: "completed",
        finishedOn: finishedAt.getTime(),
        result: returnvalue,
      });
    });

    events.on("failed", async ({ jobId, failedReason }) => {
      console.error(`[${jobType}] Job ${jobId} failed globally:`, failedReason);
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);
      const finishedAt = new Date();
      
      // Classify error type (offline, internal, or undefined)
      const failedType = classifyError(failedReason);
      if (failedType) {
        console.log(`[${jobType}] Job ${jobId} failed with type: ${failedType}`);
      }
      
      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId) },
        update: { 
          $set: { 
            state: "failed", 
            finishedAt,
            failedReason: failedReason,
            ...(failedType && { failedType }),
            updatedAt: new Date() 
          } 
        },
      });

      await publishJobUpdate(jobId, jobType, "job.failed", {
        state: "failed",
        finishedOn: finishedAt.getTime(),
        failedReason: failedReason,
        failedType,
      });
    });

    worker.on("active", (job) => {
      console.log(`[${jobType}] Local worker started job ${job.id}`);
    });

    worker.on("completed", (job) => {
      console.log(`[${jobType}] Local worker completed job ${job.id}`);
      console.log(`[${jobType}] Job ${job.id} result:`, JSON.stringify(job.returnvalue));

      if (job.returnvalue?.hasMore === true) {
        console.log(`[${jobType}] Scheduling another job for ${job.data.type} because hasMore is true`);
        enqueueJob(job.data, {
          trigger: { type: "auto", reason: "hasMore" },
        });
      }
    });

    worker.on("failed", (job, err) => {
      console.error(`[${jobType}] Local worker failed job ${job?.id}:`, err.message);
    });

    worker.on("progress", async (job, progress) => {
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);
      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(job.id) },
        update: { 
          $set: { 
            progress,
            updatedAt: new Date() 
          } 
        },
      });

      await publishJobUpdate(job.id!, jobType, "job.progress", {
        state: "active",
        progress,
        processedOn: job.processedOn,
      });
    });

    worker.on("error", (err) => {
      console.error(`[${jobType}] Worker error:`, err);
    });

    workers.push(worker);
  }

  console.log(`Started ${workers.length} worker(s) for ${jobTypes.length} job types`);
  console.log(`Python worker expected at: ${env.PYTHON_WORKER_URL}`);

  // Restore paused workers from config
  await restorePausedWorkers();
}

async function restorePausedWorkers() {
  try {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    
    const config = await mongo({
      action: "findOne",
      collection: "configs",
      query: { _id: SERVER_CONFIG_ID },
    });

    if (config?.workers) {
      await workerPauseManager.initFromConfig(config.workers);
    }
  } catch (err) {
    console.error("[workers] Failed to restore paused workers from config:", err);
  }
}

export async function stopWorkers() {
  console.log("Stopping job workers...");

  await Promise.all(workers.map((worker) => worker.close()));

  console.log("All workers stopped");
}
