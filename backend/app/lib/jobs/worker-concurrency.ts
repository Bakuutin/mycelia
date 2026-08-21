export const MIN_WORKER_CONCURRENCY = 1;
export const MAX_WORKER_CONCURRENCY = 8;

const WORKER_CONCURRENCY_CAPS: Record<string, number> = {
  // Campaign batches overlap at week boundaries while rebuilding derived
  // buckets; parallel delete/rebuild would race and corrupt totals.
  histRecalculation: 1,
};

export function getWorkerConcurrencyCap(workerType: string): number {
  return WORKER_CONCURRENCY_CAPS[workerType] ?? MAX_WORKER_CONCURRENCY;
}

export function getWorkerConcurrencyRange(workerType: string): {
  min: number;
  max: number;
} {
  return {
    min: MIN_WORKER_CONCURRENCY,
    max: getWorkerConcurrencyCap(workerType),
  };
}

export function normalizeWorkerConcurrency(
  workerType: string,
  value: unknown,
): number {
  const parsed = Number(value ?? MIN_WORKER_CONCURRENCY);
  if (!Number.isInteger(parsed)) return MIN_WORKER_CONCURRENCY;
  return Math.max(
    MIN_WORKER_CONCURRENCY,
    Math.min(parsed, getWorkerConcurrencyCap(workerType)),
  );
}

export function assertWorkerConcurrency(
  workerType: string,
  value: unknown,
): number {
  const parsed = Number(value);
  const cap = getWorkerConcurrencyCap(workerType);
  if (
    !Number.isInteger(parsed) || parsed < MIN_WORKER_CONCURRENCY || parsed > cap
  ) {
    throw new Error(
      `${workerType} concurrency must be an integer between ` +
        `${MIN_WORKER_CONCURRENCY} and ${cap}`,
    );
  }
  return parsed;
}

export function getAvailableForceStartSlots(
  effectiveConcurrency: number,
  liveJobs: number,
): number {
  return Math.max(0, effectiveConcurrency - liveJobs);
}
