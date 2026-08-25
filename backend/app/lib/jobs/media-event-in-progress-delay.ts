import { DelayedError, type Job } from "bullmq";
import { ObjectId } from "bson";
import { MEDIA_EVENT_RUN_CLAIM_LEASE_MS } from "@/lib/media-events/run-claim.server.ts";
import type { JobData, JobResult } from "./types.ts";

const RETRY_SETTLEMENT_MARGIN_MS = 1_000;
const MAX_ACCEPTED_RETRY_DELAY_MS = MEDIA_EVENT_RUN_CLAIM_LEASE_MS +
  60_000;
const ACTIVE_EVENT_SETTLEMENT_ATTEMPTS = 40;
const ACTIVE_EVENT_SETTLEMENT_DELAY_MS = 25;

type MongoOperation = (input: any) => Promise<any>;

export function mediaEventInProgressRetryAt(
  result: JobResult,
  now = new Date(),
): Date | null {
  if (result.inProgress !== true) return null;

  const requested = typeof result.retryAt === "string"
    ? new Date(result.retryAt)
    : null;
  const requestedMs = requested?.getTime();
  const latestAccepted = now.getTime() + MAX_ACCEPTED_RETRY_DELAY_MS;
  if (
    requestedMs !== undefined && Number.isFinite(requestedMs) &&
    requestedMs <= latestAccepted
  ) {
    return new Date(
      Math.max(
        now.getTime() + RETRY_SETTLEMENT_MARGIN_MS,
        requestedMs + RETRY_SETTLEMENT_MARGIN_MS,
      ),
    );
  }

  return new Date(
    now.getTime() + MEDIA_EVENT_RUN_CLAIM_LEASE_MS +
      RETRY_SETTLEMENT_MARGIN_MS,
  );
}

/**
 * Keep the stable BullMQ job alive when its durable media-event run is still
 * leased by an earlier process. The caller must invoke this before persisting
 * normal completion; this function throws BullMQ's DelayedError after moving
 * the active job so it cannot also be marked completed.
 */
export async function deferInProgressMediaEventJob(
  job: Job<JobData>,
  result: JobResult,
  mongo: MongoOperation,
  now = new Date(),
): Promise<false> {
  if (job.data.type !== "mediaEventAggregation") return false;
  const retryAt = mediaEventInProgressRetryAt(result, now);
  if (!retryAt) return false;
  if (!job.id || !ObjectId.isValid(job.id) || !job.token) {
    throw new Error("Active media event job is missing its queue identity");
  }

  const delayedMarker = {
    reason: "media_event_run_in_progress",
    retryAt,
    recordedAt: now,
    ...(typeof result.runId === "string" ? { runId: result.runId } : {}),
  };
  let marked = false;
  // QueueEvents marks Mongo active asynchronously. Wait briefly for that
  // durable transition so a late active event cannot overwrite our later
  // waiting marker after the BullMQ job has already moved to delayed.
  for (let attempt = 0; attempt < ACTIVE_EVENT_SETTLEMENT_ATTEMPTS; attempt++) {
    const markResult = await mongo({
      action: "updateOne",
      collection: "jobs",
      query: {
        _id: new ObjectId(job.id),
        type: "mediaEventAggregation",
        state: "active",
      },
      update: {
        $set: {
          state: "waiting",
          delayedRecovery: delayedMarker,
          updatedAt: now,
        },
        $unset: {
          finishedAt: "",
          failedReason: "",
          cancelReason: "",
          result: "",
        },
      },
    });
    if (Number(markResult.modifiedCount ?? 0) === 1) {
      marked = true;
      break;
    }
    if (attempt + 1 < ACTIVE_EVENT_SETTLEMENT_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, ACTIVE_EVENT_SETTLEMENT_DELAY_MS)
      );
    }
  }
  if (!marked) {
    throw new Error("Media event job changed before delayed recovery");
  }

  // Keep the waiting marker if this response is ambiguous: a successful
  // Redis move followed by a transport error must not be rewritten active and
  // later cancelled as a long-running job. A definite failure is settled by
  // BullMQ's normal failed event; global run reconciliation remains the
  // independent safety net.
  await job.moveToDelayed(retryAt.getTime(), job.token);

  throw new DelayedError();
}
