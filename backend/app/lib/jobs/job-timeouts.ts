import type { JobData } from "./types.ts";

export const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;

export function getJobTimeoutMs(
  jobType: string,
  data?: Partial<JobData> | Record<string, unknown>,
): number {
  if (jobType !== "transcription") return DEFAULT_JOB_TIMEOUT_MS;

  const rawBatchSize = Number(
    (data as Record<string, unknown> | undefined)
      ?.batchSize,
  );
  const batchSize = Number.isInteger(rawBatchSize) && rawBatchSize >= 1
    ? Math.min(rawBatchSize, 8)
    : 1;
  return DEFAULT_JOB_TIMEOUT_MS * batchSize;
}

export function getJobTimeoutMinutes(
  jobType: string,
  data?: Partial<JobData> | Record<string, unknown>,
): number {
  return getJobTimeoutMs(jobType, data) / 60_000;
}
