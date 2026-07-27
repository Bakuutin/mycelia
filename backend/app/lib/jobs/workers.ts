import type { Worker } from "bullmq";
import { ObjectId } from "bson";
import { createWorker, getQueueEvents, enqueueJob } from "./queue.ts";
import { processJob } from "./processor.ts";
import { jobRegistry, discoverJobWorkers } from "./job-registry.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { workerPauseManager } from "./worker-pause-manager.ts";
import { env } from "#/env.ts";
import { getServerConfig } from "@/lib/config/serverConfig.server.ts";
import { shouldContinueJobChain } from "./job-chain.ts";

const workers: Worker[] = [];

export async function startWorkers() {
  console.log("Starting job workers...");

  // Discover and register all job workers
  await discoverJobWorkers();
  
  // Sync discovered workers with database
  const { workerDiscovery } = await import("./worker-discovery.ts");
  await workerDiscovery.syncDiscoveredWorkers();

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
      const existingJobs = await mongo({
        action: "find",
        collection: "jobs",
        query: { _id: new ObjectId(jobId) },
        options: { limit: 1 },
      });
      const existingJob = existingJobs[0];
      const isRestart = (existingJob?.attempts ?? 0) > 0 ||
        existingJob?.finishedAt != null;

      if (isRestart) {
        console.warn(
          `[${jobType}] Job ${jobId} restarted: clearing stale terminal data ` +
            `(previous state=${existingJob?.state ?? "unknown"}, ` +
            `attempts=${existingJob?.attempts ?? 0})`,
        );
      }

      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId) },
        update: { 
          $set: { 
            state: "active", 
            startedAt,
            updatedAt: new Date(),
            ...(isRestart
              ? {
                restartInfo: {
                  detectedAt: startedAt,
                  previousState: existingJob?.state,
                  previousStartedAt: existingJob?.startedAt,
                  previousFinishedAt: existingJob?.finishedAt,
                  attempt: (existingJob?.attempts ?? 0) + 1,
                },
              }
              : {}),
          },
          $inc: { attempts: 1 },
          $unset: {
            finishedAt: "",
            failedReason: "",
            result: "",
            cancelReason: "",
          },
        },
      });

      await publishJobUpdate(jobId, jobType, "job.active", {
        state: "active",
        processedOn: startedAt.getTime(),
        restarted: isRestart,
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
      const existingJobs = await mongo({
        action: "find",
        collection: "jobs",
        query: { _id: new ObjectId(jobId) },
        options: { limit: 1 },
      });
      if (existingJobs[0]?.state === "cancelled") {
        console.log(
          `[${jobType}] Job ${jobId} was cancelled; preserving cancelled state after worker exit`,
        );
        return;
      }
      const finishedAt = new Date();
      let partialResult: Record<string, unknown> | undefined;

      if (jobType === "summarization") {
        const savedSummaryStats = await mongo({
          action: "aggregate",
          collection: "objects",
          pipeline: [
            { $match: { "summaries.jobId": jobId } },
            { $unwind: "$summaries" },
            { $match: { "summaries.jobId": jobId } },
            {
              $group: {
                _id: null,
                summariesSaved: { $sum: 1 },
                lastSummaryAt: { $max: "$summaries.date" },
              },
            },
            { $project: { _id: 0 } },
          ],
        });
        if ((savedSummaryStats[0]?.summariesSaved ?? 0) > 0) {
          partialResult = {
            ...savedSummaryStats[0],
            reason: "summaries_saved_before_job_failure",
          };
          console.warn(
            `[${jobType}] Job ${jobId} failed after saving ` +
              `${savedSummaryStats[0].summariesSaved} summary result(s)`,
          );
        }
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
            updatedAt: new Date(),
            ...(partialResult ? { partialResult } : {}),
          } 
        },
      });

      await publishJobUpdate(jobId, jobType, "job.failed", {
        state: "failed",
        finishedOn: finishedAt.getTime(),
        failedReason: failedReason,
      });
    });

    worker.on("active", (job) => {
      console.log(`[${jobType}] Local worker started job ${job.id}`);
    });

    worker.on("completed", (job) => {
      console.log(`[${jobType}] Local worker completed job ${job.id}`);
      console.log(`[${jobType}] Job ${job.id} result:`, JSON.stringify(job.returnvalue));

      if (shouldContinueJobChain(job.returnvalue)) {
        console.log(`[${jobType}] Scheduling another job for ${job.data.type} because hasMore is true`);
        enqueueJob(job.data, {
          trigger: { type: "auto", reason: "hasMore" },
        });
      } else if (job.returnvalue?.hasMore === true) {
        console.warn(
          `[${jobType}] Not scheduling another ${job.data.type} job because the previous run made no measurable progress`,
        );
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
    const config = await getServerConfig();

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
