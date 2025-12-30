import type { Worker } from "bullmq";
import { createWorker } from "./queue.ts";
import { processJob } from "./processor.ts";
import type { JobType } from "./types.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { env } from "#/env.ts";

const workers: Worker[] = [];

const JOB_TYPES: JobType[] = [
  "vad",
  "transcription",
  "diarization",
  "ingestion",
  "histRecalculation",
  "summarization",
  "testPythonIntegration",
];

export function startWorkers() {
  console.log("Starting job workers...");

  for (const jobType of JOB_TYPES) {
    const worker = createWorker(jobType, processJob);

    worker.on("active", async (job) => {
      console.log(`[${jobType}] Job ${job.id} started`);
      
      const db = await getRootDB();
      await db.collection("jobs").updateOne(
        { _id: job.id },
        { 
          $set: { 
            state: "active", 
            startedAt: new Date(),
            updatedAt: new Date() 
          },
          $inc: { attempts: 1 }
        }
      );

      await publishJobUpdate(job.id!, jobType, "job.started", {
        state: "active",
        progress: job.progress,
      });
    });

    worker.on("completed", async (job) => {
      console.log(`[${jobType}] Job ${job.id} completed`);

      const db = await getRootDB();
      await db.collection("jobs").updateOne(
        { _id: job.id },
        { 
          $set: { 
            state: "completed", 
            finishedAt: new Date(),
            result: job.returnvalue,
            updatedAt: new Date() 
          } 
        }
      );

      await publishJobUpdate(job.id!, jobType, "job.completed", {
        state: "completed",
        result: job.returnvalue,
      });
    });

    worker.on("failed", async (job, err) => {
      console.error(`[${jobType}] Job ${job?.id} failed:`, err.message);
      if (job?.id) {
        const db = await getRootDB();
        await db.collection("jobs").updateOne(
          { _id: job.id },
          { 
            $set: { 
              state: "failed", 
              finishedAt: new Date(),
              failedReason: err.message,
              updatedAt: new Date() 
            } 
          }
        );

        await publishJobUpdate(job.id, jobType, "job.failed", {
          state: "failed",
          failedReason: err.message,
        });
      }
    });

    worker.on("progress", async (job, progress) => {
      const db = await getRootDB();
      await db.collection("jobs").updateOne(
        { _id: job.id },
        { 
          $set: { 
            progress,
            updatedAt: new Date() 
          } 
        }
      );

      await publishJobUpdate(job.id!, jobType, "job.progress", {
        state: "active",
        progress,
      });
    });

    worker.on("error", (err) => {
      console.error(`[${jobType}] Worker error:`, err);
    });

    workers.push(worker);
  }

  console.log(`Started ${workers.length} worker(s) for ${JOB_TYPES.length} job types`);
  console.log(`Python worker expected at: ${env.PYTHON_WORKER_URL}`);
}

export async function stopWorkers() {
  console.log("Stopping job workers...");

  await Promise.all(workers.map((worker) => worker.close()));

  console.log("All workers stopped");
}
