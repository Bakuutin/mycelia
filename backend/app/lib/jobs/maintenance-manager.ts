import { ObjectId } from "mongodb";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { jobRegistry } from "./job-registry.ts";
import { getQueue } from "./queue.ts";

const JOB_TIMEOUT_MS = 15 * 60 * 1000;
const MAINTENANCE_INTERVAL_MS = 60 * 1000;
const WAITING_MISSING_GRACE_MS = 2 * 60 * 1000;

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
      await this.cancelLongRunningJobs();
      await this.cancelMissingWaitingJobs();
    } finally {
      this.running = false;
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
        continue;
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
