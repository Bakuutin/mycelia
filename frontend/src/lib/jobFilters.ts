export function getToggledWorkerFilter(
  allSelected: boolean,
  selectedTypes: Set<string>,
  workerType: string,
): { allSelected: boolean; selectedTypes: Set<string> } {
  if (
    !allSelected && selectedTypes.size === 1 && selectedTypes.has(workerType)
  ) {
    return { allSelected: true, selectedTypes: new Set() };
  }
  return { allSelected: false, selectedTypes: new Set([workerType]) };
}

export const MEDIA_RECOGNITION_ITEM_JOB_TYPE = "mediaRecognition";
export const MEDIA_RECOGNITION_BATCH_JOB_TYPE = "mediaRecognitionBatch";
const LOGICAL_CAMPAIGN_JOB_TYPES = new Set([
  "mediaFolderImport",
  MEDIA_RECOGNITION_BATCH_JOB_TYPE,
]);
const DOMAIN_MANAGED_MEDIA_JOB_TYPES = new Set([
  "mediaFolderImport",
  MEDIA_RECOGNITION_BATCH_JOB_TYPE,
  MEDIA_RECOGNITION_ITEM_JOB_TYPE,
]);

export const GLOBAL_QUEUE_CLEAR_DESCRIPTION =
  "Active jobs will keep running so their locks and saved results remain consistent.\n\n" +
  "Media import and photo analysis campaigns are managed on their Media pages and will remain untouched.";

export function managedWorkerDestination(workerType: string): {
  to: string;
  label: string;
} {
  if (workerType === "mediaFolderImport") {
    return { to: "/media", label: "Media library" };
  }
  if (
    workerType === MEDIA_RECOGNITION_BATCH_JOB_TYPE ||
    workerType === MEDIA_RECOGNITION_ITEM_JOB_TYPE
  ) {
    return { to: "/media/analysis", label: "Photo analysis" };
  }
  return { to: "/audio/pipeline", label: "Audio Pipeline" };
}

export function canClearWorkerQueue(workerType: string): boolean {
  // Clearing only a technical coordinator does not cancel the durable domain
  // campaign; its watchdog would recreate the job. Stop these workflows from
  // their Media pages, where durable campaign state is updated as well.
  return !DOMAIN_MANAGED_MEDIA_JOB_TYPES.has(workerType);
}

export function canRerunJobFromJobs(workerType: string): boolean {
  return !DOMAIN_MANAGED_MEDIA_JOB_TYPES.has(workerType);
}

export function canCancelJobFromJobs(workerType: string): boolean {
  return !DOMAIN_MANAGED_MEDIA_JOB_TYPES.has(workerType);
}

export function selectionUsesLogicalCampaign(
  selectedTypes: Set<string>,
): boolean {
  return [...selectedTypes].some((type) =>
    LOGICAL_CAMPAIGN_JOB_TYPES.has(type)
  );
}

/**
 * Old photo-analysis links opened hundreds of item jobs. Keep `internal=1` as
 * the explicit diagnostics escape hatch, otherwise route them to the durable
 * coordinator row users can actually act on.
 */
export function normalizeMediaRecognitionJobParams(
  searchParams: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  if (next.get("internal") === "1") return next;

  const types = (next.get("type") ?? "").split(",").filter(Boolean);
  if (!types.includes(MEDIA_RECOGNITION_ITEM_JOB_TYPE)) return next;

  const normalized = [
    ...new Set(
      types.map((type) =>
        type === MEDIA_RECOGNITION_ITEM_JOB_TYPE
          ? MEDIA_RECOGNITION_BATCH_JOB_TYPE
          : type
      ),
    ),
  ];
  next.set("type", normalized.join(","));
  return next;
}

export interface JobTypeStat {
  type: string;
  active?: number;
  waiting?: number;
  delayed?: number;
  completed?: number;
  failed?: number;
  totalRuns?: number;
  idleAutoRuns?: number;
}

export function selectedJobTypeTotals(
  stats: JobTypeStat[] | undefined,
  selectedTypes: Set<string>,
) {
  if (!stats) return null;
  const selected = stats.filter((stat) => selectedTypes.has(stat.type));
  if (selected.length === 0) return null;

  return selected.reduce((totals, stat) => ({
    active: totals.active + (stat.active ?? 0),
    waiting: totals.waiting + (stat.waiting ?? 0),
    delayed: totals.delayed + (stat.delayed ?? 0),
    completed: totals.completed + (stat.completed ?? 0),
    failed: totals.failed + (stat.failed ?? 0),
    total: totals.total + (stat.totalRuns ?? 0),
    idleAutoRuns: totals.idleAutoRuns + (stat.idleAutoRuns ?? 0),
  }), {
    active: 0,
    waiting: 0,
    delayed: 0,
    completed: 0,
    failed: 0,
    total: 0,
    idleAutoRuns: 0,
  });
}
