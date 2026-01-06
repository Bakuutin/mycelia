import type { Worker } from "bullmq";
import { ObjectId } from "mongodb";
import { createWorker } from "./queue.ts";
import { processJob } from "./processor.ts";
import { jobRegistry, discoverJobWorkers } from "./job-registry.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { env } from "#/env.ts";

const workers: Worker[] = [];

export async function startWorkers() {
  console.log("Starting job workers...");

  // Discover and register all job workers
  await discoverJobWorkers();

  const jobTypes = jobRegistry.getJobTypes();

  for (const jobType of jobTypes) {
    const worker = createWorker(jobType, processJob);

    worker.on("active", async (job) => {
      console.log(`[${jobType}] Job ${job.id} started`);
      
      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);
      const startedAt = new Date();
      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(job.id) },
        update: { 
          $set: { 
            state: "active", 
            startedAt,
            updatedAt: new Date() 
          },
          $inc: { attempts: 1 }
        },
      });

      await publishJobUpdate(job.id!, jobType, "job.started", {
        state: "active",
        processedOn: startedAt.getTime(),
        progress: job.progress,
      });
    });

    worker.on("completed", async (job) => {
      console.log(`[${jobType}] Job ${job.id} completed`);

      const auth = await getServerAuth();
      const mongo = await getMongoResource(auth);
      const finishedAt = new Date();
      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(job.id) },
        update: { 
          $set: { 
            state: "completed", 
            finishedAt,
            result: job.returnvalue,
            updatedAt: new Date() 
          } 
        },
      });

      await publishJobUpdate(job.id!, jobType, "job.completed", {
        state: "completed",
        finishedOn: finishedAt.getTime(),
        processedOn: job.processedOn,
        result: job.returnvalue,
      });
    });

    worker.on("failed", async (job, err) => {
      console.error(`[${jobType}] Job ${job?.id} failed:`, err.message);
      if (job?.id) {
        const auth = await getServerAuth();
        const mongo = await getMongoResource(auth);
        const finishedAt = new Date();
        await mongo({
          action: "updateOne",
          collection: "jobs",
          query: { _id: new ObjectId(job.id) },
          update: { 
            $set: { 
              state: "failed", 
              finishedAt,
              failedReason: err.message,
              updatedAt: new Date() 
            } 
          },
        });

        await publishJobUpdate(job.id, jobType, "job.failed", {
          state: "failed",
          finishedOn: finishedAt.getTime(),
          processedOn: job.processedOn,
          failedReason: err.message,
        });
      }
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
}

export async function stopWorkers() {
  console.log("Stopping job workers...");

  await Promise.all(workers.map((worker) => worker.close()));

  console.log("All workers stopped");
}
