export type TimelineRebuildBatch = {
  start: Date;
  end: Date;
  batchIndex: number;
};

export type TimelineRebuildRange = {
  start: Date;
  end: Date;
};

export type TimelineCountSource = "audio_chunks" | "transcriptions";

export type TimelineRepairRange = TimelineRebuildRange & {
  days: number;
  differences: Record<TimelineCountSource, number>;
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

/**
 * Normalize selected repair periods before they become durable campaign
 * metadata. Overlapping or adjacent periods are merged, while disjoint dates
 * remain separate so a sparse repair never expands into a multi-year rebuild.
 */
export function normalizeTimelineRebuildRanges(
  ranges: TimelineRebuildRange[],
): TimelineRebuildRange[] {
  if (ranges.length === 0) {
    throw new Error("At least one Timeline rebuild range is required");
  }
  const sorted = ranges.map((range) => {
    const start = new Date(range.start);
    const end = new Date(range.end);
    buildTimelineRebuildBatches(start, end, 62);
    return { start, end };
  }).sort((a, b) => a.start.getTime() - b.start.getTime());

  const normalized: TimelineRebuildRange[] = [];
  for (const range of sorted) {
    const previous = normalized.at(-1);
    if (previous && range.start.getTime() <= previous.end.getTime()) {
      if (range.end > previous.end) previous.end = range.end;
      continue;
    }
    normalized.push({ ...range });
  }
  return normalized;
}

export function buildTimelineRebuildRangeBatches(
  ranges: TimelineRebuildRange[],
  batchDays = 31,
): TimelineRebuildBatch[] {
  return normalizeTimelineRebuildRanges(ranges).flatMap((range) =>
    buildTimelineRebuildBatches(range.start, range.end, batchDays)
  ).map((batch, batchIndex) => ({ ...batch, batchIndex }));
}

/**
 * Compare exact UTC-day source counts with the persisted 1-day density totals
 * and return only the dates that need repair. Adjacent mismatched days are
 * combined into one bounded range; separated dates stay separated.
 */
export function findTimelineRepairRanges(
  rawDays: Array<{
    start: Date;
    counts: Record<TimelineCountSource, number>;
  }>,
  histogramDays: Array<{
    start: Date;
    counts: Record<TimelineCountSource, number>;
  }>,
): TimelineRepairRange[] {
  const counts = new Map<
    number,
    {
      raw: Record<TimelineCountSource, number>;
      histogram: Record<TimelineCountSource, number>;
    }
  >();
  const empty = (): Record<TimelineCountSource, number> => ({
    audio_chunks: 0,
    transcriptions: 0,
  });
  for (const row of rawDays) {
    const key = row.start.getTime();
    const value = counts.get(key) ?? { raw: empty(), histogram: empty() };
    value.raw = { ...row.counts };
    counts.set(key, value);
  }
  for (const row of histogramDays) {
    const key = row.start.getTime();
    const value = counts.get(key) ?? { raw: empty(), histogram: empty() };
    value.histogram = { ...row.counts };
    counts.set(key, value);
  }

  const repairs: TimelineRepairRange[] = [];
  for (
    const [startMs, value] of [...counts.entries()].sort((a, b) => a[0] - b[0])
  ) {
    const differences = {
      audio_chunks: value.histogram.audio_chunks - value.raw.audio_chunks,
      transcriptions: value.histogram.transcriptions - value.raw.transcriptions,
    };
    if (differences.audio_chunks === 0 && differences.transcriptions === 0) {
      continue;
    }
    const endMs = startMs + DAY_MS;
    const previous = repairs.at(-1);
    if (previous?.end.getTime() === startMs) {
      previous.end = new Date(endMs);
      previous.days += 1;
      previous.differences.audio_chunks += differences.audio_chunks;
      previous.differences.transcriptions += differences.transcriptions;
    } else {
      repairs.push({
        start: new Date(startMs),
        end: new Date(endMs),
        days: 1,
        differences,
      });
    }
  }
  return repairs;
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
