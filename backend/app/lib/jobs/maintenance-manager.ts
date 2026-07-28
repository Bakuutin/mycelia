import { ObjectId } from "bson";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { jobRegistry } from "./job-registry.ts";
import { getQueue } from "./queue.ts";

const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 60 * 1000;
const WAITING_MISSING_GRACE_MS = 2 * 60 * 1000;
const ACTIVE_MISSING_GRACE_MS = 30 * 1000;
const LIVE_QUEUE_STATES = new Set([
  "active",
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children",
]);

export class MaintenanceManager {
  private interval: number | null = null;
  private running = false;

  async start() {
    if (this.interval !== null) return;
    await this.runMaintenance();
    this.interval = setInterval(() => {
      this.runMaintenance();
    }, MAINTENANCE_INTERVAL_MS);
  }

  async stop() {
    if (this.interval === null) return;
    clearInterval(this.interval);
    this.interval = null;
  }

  private async runMaintenance() {
    if (this.running) return;
    this.running = true;
    try {
      await this.cancelMissingActiveJobs();
      await this.cancelLongRunningJobs();
      await this.cancelMissingWaitingJobs();
      await this.releaseCompletedSummarizationClaims();
    } finally {
      this.running = false;
    }
  }

  private async cancelMissingActiveJobs() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const cutoff = new Date(Date.now() - ACTIVE_MISSING_GRACE_MS);
    const activeJobs = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        state: "active",
        updatedAt: { $lte: cutoff },
      },
      options: { limit: 500 },
    });

    for (const job of activeJobs) {
      const jobId = job._id?.toString();
      const jobType = job.type as string | undefined;
      if (!jobId || !jobType || !jobRegistry.get(jobType)) continue;

      const queueJob = await getQueue(jobType).getJob(jobId);
      if (queueJob && LIVE_QUEUE_STATES.has(await queueJob.getState())) {
        continue;
      }

      const now = new Date();
      const result = await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId), state: "active" },
        update: {
          $set: {
            state: "cancelled",
            cancelReason: "queue_record_missing",
            failedReason: "queue_record_missing",
            finishedAt: now,
            updatedAt: now,
          },
        },
      });
      if ((result.modifiedCount ?? 0) === 0) continue;

      if (jobType === "summarization") {
        await mongo({
          action: "updateMany",
          collection: "objects",
          query: { "_summarizationClaim.jobId": jobId },
          update: { $unset: { _summarizationClaim: "" } },
        });
      } else if (jobType === "conversation_extractor") {
        await mongo({
          action: "updateMany",
          collection: "conversation_chunks",
          query: { state: "processing", processedByJobId: jobId },
          update: {
            $set: {
              state: "error",
              error: "Worker process disappeared before completing the job",
              extractionLastErrorAt: now,
              extractionRetryAfter: now,
            },
            $unset: { processingStartedAt: "" },
          },
        });
      }

      await publishJobUpdate(jobId, jobType, "job.state", {
        state: "cancelled",
        finishedOn: now.getTime(),
      });
      console.warn(
        `[SELF-HEAL] Cancelled orphaned active job ${jobId} in ${jobType}; its BullMQ record is missing.`,
      );
    }
  }

  private async releaseCompletedSummarizationClaims() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const result = await mongo({
      action: "updateMany",
      collection: "objects",
      query: {
        "_summarizationClaim.jobId": { $exists: true },
        "summaries.0": { $exists: true },
      },
      update: { $unset: { _summarizationClaim: "" } },
    });

    if ((result.modifiedCount ?? 0) > 0) {
      console.warn(
        `[SELF-HEAL] Released ${result.modifiedCount} completed summarization claim(s).`,
      );
    }
  }

  private async cancelLongRunningJobs() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const cutoff = new Date(Date.now() - JOB_TIMEOUT_MS);

    const staleJobs = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        state: "active",
        startedAt: { $lte: cutoff },
      },
      options: { limit: 500 },
    });

    if (staleJobs.length === 0) {
      return;
    }

    for (const job of staleJobs) {
      const jobId = job._id?.toString();
      const jobType = job.type as string | undefined;
      if (!jobId || !jobType || !jobRegistry.get(jobType)) {
        continue;
      }

      const queue = getQueue(jobType);
      try {
        const removed = await queue.remove(jobId);
        if (removed === 0) {
          console.warn(
            `[MaintenanceManager] Job ${jobId} in ${jobType} could not be removed (locked).`,
          );
        }
      } catch (err) {
        console.warn(
          `[MaintenanceManager] Failed to remove job ${jobId} from ${jobType}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId), state: "active" },
        update: {
          $set: {
            state: "cancelled",
            cancelReason: "timeout",
            failedReason: "timeout",
            finishedAt: new Date(),
            updatedAt: new Date(),
          },
        },
      });

      await publishJobUpdate(jobId, jobType, "job.state", {
        state: "cancelled",
        finishedOn: Date.now(),
      });
    }
  }

  private async cancelMissingWaitingJobs() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const cutoff = new Date(Date.now() - WAITING_MISSING_GRACE_MS);

    const waitingJobs = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        state: "waiting",
        createdAt: { $lte: cutoff },
      },
      options: { limit: 500 },
    });

    if (waitingJobs.length === 0) {
      return;
    }

    for (const job of waitingJobs) {
      const jobId = job._id?.toString();
      const jobType = job.type as string | undefined;
      if (!jobId || !jobType || !jobRegistry.get(jobType)) {
        continue;
      }

      const queue = getQueue(jobType);
      const queueJob = await queue.getJob(jobId);
      if (queueJob) {
        const queueState = await queueJob.getState();
        if (LIVE_QUEUE_STATES.has(queueState)) {
          continue;
        }

        // Mongo can say "waiting" after the BullMQ job has already reached a
        // terminal state (for example when the backend missed a Redis event).
        // Remove that terminal queue record so the same stable job ID can be
        // added again below.
        try {
          await queueJob.remove();
          console.warn(
            `[MaintenanceManager] Removed terminal ${queueState} queue record for waiting job ${jobId} in ${jobType}.`,
          );
        } catch (err) {
          console.warn(
            `[MaintenanceManager] Failed to remove terminal queue record ${jobId} in ${jobType}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          continue;
        }
      }

      try {
        await queue.add(jobType, job.data, { jobId });
      } catch (err) {
        console.warn(
          `[MaintenanceManager] Failed to re-enqueue job ${jobId} in ${jobType}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }

      await mongo({
        action: "updateOne",
        collection: "jobs",
        query: { _id: new ObjectId(jobId), state: "waiting" },
        update: {
          $set: {
            state: "waiting",
            requeuedAt: new Date(),
            updatedAt: new Date(),
          },
          $unset: {
            cancelReason: "",
            failedReason: "",
            finishedAt: "",
          },
        },
      });

      await publishJobUpdate(jobId, jobType, "job.state", {
        state: "waiting",
      });
    }
  }
}

export const maintenanceManager = new MaintenanceManager();
