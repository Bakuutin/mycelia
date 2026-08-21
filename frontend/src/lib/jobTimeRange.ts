import type { JobInfo } from "@/types/jobs";

export type JobTimeRange = {
  start: Date;
  end: Date | null;
  source: "processed" | "requested";
};

function validDate(value: unknown): Date | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readRange(
  value: unknown,
  source: JobTimeRange["source"],
): JobTimeRange | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const range = value as Record<string, unknown>;
  const start = validDate(range.start);
  if (!start) return null;
  const end = validDate(range.end);
  if (end && end.getTime() < start.getTime()) return null;
  return { start, end, source };
}

/**
 * Prefer the audio interval actually completed by a worker. Older and manual
 * jobs fall back to their requested start/end range without a database lookup.
 */
export function getJobTimeRange(job: JobInfo): JobTimeRange | null {
  return readRange(job.result?.processedRange, "processed") ??
    readRange(job.progress?.processedRange, "processed") ??
    readRange(job.data, "requested");
}
