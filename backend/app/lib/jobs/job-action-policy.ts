import { getWorkerCatalogEntry } from "@/lib/jobs/worker-catalog.ts";

/**
 * Folder import and paid photo analysis are durable domain workflows. Removing
 * only a BullMQ coordinator or child job leaves campaign state runnable and
 * can cause recovery to recreate work. Generic Jobs queue maintenance must
 * therefore leave every domain-managed layer untouched.
 */
export const DOMAIN_MANAGED_MEDIA_JOB_TYPES = [
  "mediaFolderImport",
  "mediaRecognitionBatch",
  "mediaRecognition",
] as const;

const DOMAIN_MANAGED_MEDIA_JOB_TYPE_SET = new Set<string>(
  DOMAIN_MANAGED_MEDIA_JOB_TYPES,
);

export function jobTypesForGlobalQueueClear(
  types: Iterable<string>,
): string[] {
  return [...types].filter((type) =>
    !DOMAIN_MANAGED_MEDIA_JOB_TYPE_SET.has(type)
  );
}

export function globalQueueClearJobsQuery() {
  return {
    type: { $nin: [...DOMAIN_MANAGED_MEDIA_JOB_TYPES] },
    state: { $in: ["waiting", "delayed"] },
  };
}

export function canUseGenericQueueAction(workerType: string): boolean {
  return !DOMAIN_MANAGED_MEDIA_JOB_TYPE_SET.has(workerType);
}

export function assertCanUseGenericQueueAction(workerType: string): void {
  if (canUseGenericQueueAction(workerType)) return;
  throw new Error(
    `${workerType} is a domain-managed media campaign; use Media controls instead of generic Jobs queue actions`,
  );
}

/**
 * The public Jobs launcher is allow-listed by the worker catalog. Workers that
 * are absent from the catalog are internal/domain-only; catalog entries with
 * manualRun:false must be started through their owning workflow instead.
 * Internal callers continue to use enqueueJob directly and are unaffected.
 */
export function canRunWorkerFromJobs(workerType: string): boolean {
  return getWorkerCatalogEntry(workerType)?.capabilities.manualRun === true;
}

export function assertCanRunWorkerFromJobs(workerType: string): void {
  if (canRunWorkerFromJobs(workerType)) return;
  throw new Error(
    `${workerType} is managed outside Jobs and cannot be launched or restarted here`,
  );
}

export function manualJobSchemas<T>(
  schemas: Record<string, T>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(schemas).filter(([workerType]) =>
      canRunWorkerFromJobs(workerType)
    ),
  );
}
