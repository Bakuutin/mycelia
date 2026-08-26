import { ObjectId } from "bson";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { jobRegistry } from "./job-registry.ts";
import {
  drainWaitingDiarizatorJobs,
  getQueue,
  requestDiarizatorAdmissionDrain,
  requeuePersistedJob,
} from "./queue.ts";
import { DEFAULT_JOB_TIMEOUT_MS, getJobTimeoutMs } from "./job-timeouts.ts";
import { getRedisConnectedForMs } from "@/lib/redis.ts";
import { isJobRunningLocally } from "./processor.ts";
import { canTrustMissingQueueRecords } from "./orphan-reaper.ts";
import { releaseStaleAudioChunkClaims } from "./audio-claim-reaper.ts";
import { releaseCompletedSummarizationClaims } from "./summarization-claim-reaper.ts";
import {
  DIARIZATOR_WAITING_FOR_SLOT,
  isDiarizatorRoutedJobType,
} from "./diarizator-admission.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { reconcileExpiredMediaEventRuns } from "@/lib/media-events/resource.server.ts";
import { reconcileExpiredMediaEventRunsGlobally } from "./media-event-run-reaper.ts";
import { reconcileIdentityCampaignReservations } from "./identity-campaign-recovery.ts";

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
  private interval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  async start() {
    if (this.interval !== null) return;
    this.interval = setInterval(() => {
      void this.runMaintenance().catch((error) => {
        console.error(
          "[MaintenanceManager] Periodic maintenance failed:",
          error,
        );
      });
    }, MAINTENANCE_INTERVAL_MS);

    // Reconciliation can visit a large amount of retained job history. It is
    // important work, but must not hold the application's readiness signal
    // after workers and triggers have already started accepting work.
    void this.runMaintenance().catch((error) => {
      console.error("[MaintenanceManager] Startup maintenance failed:", error);
    });
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
      // Event-driven drains normally keep the pool full. This periodic pass is
      // only a watchdog for a missed Redis event or an interrupted backend.
      try {
        await drainWaitingDiarizatorJobs({
          reason: "maintenance.watchdog",
        });
      } catch (error) {
        console.warn(
          `[MaintenanceManager] Diarizator admission watchdog failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      await this.reconcileTerminalDiarizatorAdmissionMarkers();

      const mediaEvents = await reconcileExpiredMediaEventRunsGlobally(
        await getRootDB(),
        reconcileExpiredMediaEventRuns,
      );
      if (
        mediaEvents.released || mediaEvents.outcomeUnknown ||
        mediaEvents.settlementPending || mediaEvents.ownerFailures
      ) {
        console.warn(
          "[SELF-HEAL] Reconciled expired media event runs.",
          mediaEvents,
        );
      }

      try {
        const identityRecovery = await reconcileIdentityCampaignReservations();
        if (identityRecovery.recovered > 0) {
          console.warn(
            `[SELF-HEAL] Re-enqueued ${identityRecovery.recovered} speaker identity campaign reservation(s).`,
          );
        }
      } catch (error) {
        console.warn(
          `[MaintenanceManager] Speaker identity reservation recovery failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      // Waiting jobs have no running process to protect and are cheap to
      // recover. Do this before the potentially expensive orphan sweep so a
      // large retained active history cannot starve queue recovery.
      await this.cancelMissingWaitingJobs();
      await this.cancelMissingActiveJobs();
      await this.cancelLongRunningJobs();
      await this.releaseCompletedSummarizationClaims();
      await this.releaseStaleAudioClaims();
    } finally {
      this.running = false;
    }
  }

  private async releaseStaleAudioClaims() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const released = await releaseStaleAudioChunkClaims(mongo);
    if (released > 0) {
      console.warn(
        `[SELF-HEAL] Released ${released} stale audio chunk claim(s).`,
      );
    }
  }

  private async cancelMissingActiveJobs() {
    // A missing BullMQ record is only evidence of an orphan when Redis itself
    // has been healthy long enough for that absence to mean something.
    const trust = canTrustMissingQueueRecords(getRedisConnectedForMs());
    if (!trust.trusted) {
      console.warn(
        `[MaintenanceManager] Skipping orphaned-job sweep: ${trust.reason}.`,
      );
      return;
    }

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

      // The worker child outlives the queue record. Cancelling here would mark
      // a job dead while it is still transcribing, and the result it later
      // commits would contradict the cancellation.
      if (isJobRunningLocally(jobId)) continue;

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
      } else if (jobType === "conversation_extractor_merged") {
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
      if (isDiarizatorRoutedJobType(jobType)) {
        requestDiarizatorAdmissionDrain(
          `maintenance.cancelled_missing:${jobType}`,
        );
      }
      console.warn(
        `[SELF-HEAL] Cancelled orphaned active job ${jobId} in ${jobType}; its BullMQ record is missing.`,
      );
    }
  }

  private async releaseCompletedSummarizationClaims() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const result = await releaseCompletedSummarizationClaims(mongo);

    if (result.modified > 0) {
      console.warn(
        `[SELF-HEAL] Released ${result.modified} completed summarization claim(s).${
          result.hasMore ? " More bounded cleanup work remains." : ""
        }`,
      );
    }
  }

  private async cancelLongRunningJobs() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const cutoff = new Date(Date.now() - DEFAULT_JOB_TIMEOUT_MS);

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
      const startedAt = job.startedAt instanceof Date
        ? job.startedAt
        : new Date(job.startedAt);
      if (
        Date.now() - startedAt.getTime() < getJobTimeoutMs(jobType, job.data)
      ) {
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
      if (isDiarizatorRoutedJobType(jobType)) {
        requestDiarizatorAdmissionDrain(
          `maintenance.cancelled_timeout:${jobType}`,
        );
      }
    }
  }

  private async reconcileTerminalDiarizatorAdmissionMarkers() {
    const auth = await getServerAuth();
    const mongo = await getMongoResource(auth);
    const staleMarkers = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        state: { $in: ["completed", "failed", "cancelled"] },
        "queueAdmission.state": DIARIZATOR_WAITING_FOR_SLOT,
      },
      options: { projection: { _id: 1 }, limit: 500 },
    });
    const ids = staleMarkers.flatMap((job: Record<string, any>) => {
      const id = job._id?.toString();
      return id && ObjectId.isValid(id) ? [new ObjectId(id)] : [];
    });
    if (ids.length === 0) return;

    const reconciledAt = new Date();
    const result = await mongo({
      action: "updateMany",
      collection: "jobs",
      query: {
        _id: { $in: ids },
        state: { $in: ["completed", "failed", "cancelled"] },
        "queueAdmission.state": DIARIZATOR_WAITING_FOR_SLOT,
      },
      update: {
        $set: {
          "queueAdmission.state": "admitted",
          "queueAdmission.reconciledAt": reconciledAt,
          "queueAdmission.reconciliationReason":
            "terminal_job_cannot_wait_for_slot",
        },
      },
    });
    if ((result.modifiedCount ?? 0) > 0) {
      console.warn(
        `[SELF-HEAL] Reconciled ${result.modifiedCount} stale terminal diarizator admission marker(s).`,
      );
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
        "queueAdmission.state": { $ne: DIARIZATOR_WAITING_FOR_SLOT },
      },
      options: { sort: { priority: 1, createdAt: 1 }, limit: 500 },
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
        await requeuePersistedJob({
          jobId,
          jobType,
          jobData: job.data,
          priority: job.priority,
        }, auth);
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
            "queueAdmission.state": "admitted",
            "queueAdmission.admittedAt": new Date(),
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
