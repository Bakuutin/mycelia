export type JobsListView = "operational" | "idle_auto";
export type JobListStatus =
  | "active"
  | "waiting"
  | "delayed"
  | "completed"
  | "failed"
  | "cancelled";

const DEFAULT_JOB_STATUSES: JobListStatus[] = [
  "active",
  "waiting",
  "delayed",
  "completed",
  "failed",
  "cancelled",
];

const DEFAULT_INTERNAL_JOB_TYPES = new Set(["mediaRecognition"]);

/**
 * Individual photo-recognition jobs are implementation details of one durable
 * recognition batch. Keep their WebSocket traffic out of the default Jobs
 * views; an explicit type filter remains available for diagnostics.
 */
export function shouldIncludeJobEvent(
  jobType: string,
  selectedTypes?: string[],
): boolean {
  if (selectedTypes?.length) return selectedTypes.includes(jobType);
  return !DEFAULT_INTERNAL_JOB_TYPES.has(jobType);
}

export function buildJobsListRequest(
  view: JobsListView,
  types?: string[],
  options: {
    statuses?: JobListStatus[];
    limit?: number;
    providerProfileId?: string;
    campaignId?: string;
  } = {},
) {
  return {
    action: "list" as const,
    view,
    limit: options.limit ?? 1000,
    statuses: options.statuses ?? DEFAULT_JOB_STATUSES,
    ...(types?.length ? { types } : {}),
    ...(options.providerProfileId
      ? { providerProfileId: options.providerProfileId }
      : {}),
    ...(options.campaignId ? { campaignId: options.campaignId } : {}),
  };
}

export function shouldRefreshJobsViews(eventName: string): boolean {
  return eventName === "job.completed";
}

/**
 * WebSocket event names describe what changed, not necessarily a persisted
 * lifecycle state. In particular, `job.progress` must never turn an active
 * job into a synthetic `progress` state and make it disappear from filters.
 */
export function resolveJobEventState(
  eventName: string,
  payloadState: string | undefined,
  currentState: string,
): string {
  if (payloadState) return payloadState;
  switch (eventName) {
    case "job.started":
    case "job.active":
      return "active";
    case "job.waiting":
      return "waiting";
    case "job.delayed":
      return "delayed";
    case "job.completed":
      return "completed";
    case "job.failed":
      return "failed";
    case "job.cancelled":
      return "cancelled";
    default:
      return currentState;
  }
}

export function getJobsListView(searchParams: URLSearchParams): JobsListView {
  return searchParams.get("view") === "empty" ? "idle_auto" : "operational";
}

export function withJobsListView(
  searchParams: URLSearchParams,
  view: JobsListView,
): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  next.delete("hideEmpty");
  if (view === "idle_auto") next.set("view", "empty");
  else next.delete("view");
  return next;
}
