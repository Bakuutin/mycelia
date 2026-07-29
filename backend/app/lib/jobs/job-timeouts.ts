import type { JobData } from "./types.ts";

export const DEFAULT_JOB_TIMEOUT_MS = 15 * 60 * 1000;
export const DEFAULT_TRANSCRIPTION_TIMEOUT_BASE_MS = 2 * 60 * 1000;
export const DEFAULT_TRANSCRIPTION_TIMEOUT_PER_SEQUENCE_MS = 60 * 1000;
export const MAX_TRANSCRIPTION_BATCH_SIZE = 32;

function readBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min
    ? Math.min(parsed, max)
    : fallback;
}

export function getJobTimeoutMs(
  jobType: string,
  data?: Partial<JobData> | Record<string, unknown>,
): number {
  if (jobType !== "transcription") return DEFAULT_JOB_TIMEOUT_MS;

  const transcriptionData = data as Record<string, unknown> | undefined;
  const batchSize = readBoundedInteger(
    transcriptionData?.batchSize,
    1,
    1,
    MAX_TRANSCRIPTION_BATCH_SIZE,
  );
  const baseMs = readBoundedInteger(
    transcriptionData?.batchTimeoutBaseSeconds,
    DEFAULT_TRANSCRIPTION_TIMEOUT_BASE_MS / 1000,
    60,
    1800,
  ) * 1000;
  const perSequenceMs = readBoundedInteger(
    transcriptionData?.batchTimeoutPerSequenceSeconds,
    DEFAULT_TRANSCRIPTION_TIMEOUT_PER_SEQUENCE_MS / 1000,
    15,
    300,
  ) * 1000;
  return baseMs + perSequenceMs * batchSize;
}

export function getJobTimeoutMinutes(
  jobType: string,
  data?: Partial<JobData> | Record<string, unknown>,
): number {
  return getJobTimeoutMs(jobType, data) / 60_000;
}
