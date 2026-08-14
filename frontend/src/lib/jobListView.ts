export type JobsListView = "operational" | "idle_auto";

export function buildJobsListRequest(
  view: JobsListView,
  types?: string[],
) {
  return {
    action: "list" as const,
    view,
    limit: 1000,
    statuses: [
      "active",
      "waiting",
      "delayed",
      "completed",
      "failed",
      "cancelled",
    ],
    ...(types?.length ? { types } : {}),
  };
}

export function shouldRefreshJobsViews(eventName: string): boolean {
  return eventName === "job.completed";
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
