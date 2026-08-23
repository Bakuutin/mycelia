export type TimelineRebuildBatch = {
  start: Date;
  end: Date;
  batchIndex: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Split a historical rebuild into bounded, contiguous jobs. Keeping the
 * batches independent makes the campaign resumable from normal job history
 * and prevents one multi-year request from monopolizing a worker lease.
 */
export function buildTimelineRebuildBatches(
  start: Date,
  end: Date,
  batchDays = 31,
): TimelineRebuildBatch[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new Error("Timeline rebuild range must contain valid dates");
  }
  if (startMs >= endMs) {
    throw new Error("Timeline rebuild start must be before end");
  }
  if (!Number.isInteger(batchDays) || batchDays < 1 || batchDays > 62) {
    throw new Error("Timeline rebuild batchDays must be between 1 and 62");
  }

  const batchMs = batchDays * DAY_MS;
  const batches: TimelineRebuildBatch[] = [];
  let cursor = startMs;
  while (cursor < endMs) {
    const batchEnd = Math.min(cursor + batchMs, endMs);
    batches.push({
      start: new Date(cursor),
      end: new Date(batchEnd),
      batchIndex: batches.length,
    });
    cursor = batchEnd;
  }
  return batches;
}

export function timelineCampaignStatus(counts: {
  total: number;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  cancelled: number;
  completed: number;
}): "queued" | "running" | "completed" | "completed_with_errors" {
  if (counts.active > 0) return "running";
  if (counts.waiting + counts.delayed > 0) return "queued";
  if (counts.failed + counts.cancelled > 0) return "completed_with_errors";
  return counts.completed >= counts.total ? "completed" : "queued";
}

export type TimelineCampaignRecoveryStatus =
  | "paused_legacy"
  | "paused"
  | "paused_error"
  | "queued"
  | "running"
  | "recovering"
  | "verifying"
  | "completed"
  | "completed_with_errors";

export function deriveTimelineCampaignRecoveryStatus(input: {
  storedStatus?: string;
  active: number;
  waiting: number;
  delayed: number;
  failed: number;
  cancelled: number;
  missingJobs: number;
}): TimelineCampaignRecoveryStatus {
  if (input.storedStatus?.startsWith("paused")) {
    return input.storedStatus as TimelineCampaignRecoveryStatus;
  }
  if (input.active > 0) return "running";
  if (input.waiting + input.delayed > 0) return "queued";
  if (input.failed + input.cancelled > 0) return "paused_error";
  if (input.missingJobs > 0) return "recovering";
  if (
    input.storedStatus === "completed" ||
    input.storedStatus === "completed_with_errors"
  ) {
    return input.storedStatus;
  }
  return "verifying";
}

export function timelineVerificationOutcome(
  reportStatus: "healthy" | "needs_attention",
) {
  return reportStatus === "healthy"
    ? {
      status: "completed" as const,
      blockingReason: null,
    }
    : {
      status: "completed_with_errors" as const,
      blockingReason:
        "Exact integrity verification found remaining differences. Review the audit and start a new bounded rebuild for the current source range.",
    };
}
