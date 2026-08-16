import type { JobInfo } from "@/types/jobs";

export type DiarizationRuntimeRoute = {
  id: string;
  name: string;
  baseUrl?: string;
  enabled: boolean;
  concurrency: number;
  health?: string;
};

export type DiarizationSlotState =
  | "processing"
  | "queued"
  | "stale"
  | "idle"
  | "disabled";

export type DiarizationRuntimeSlot = {
  index: number;
  state: DiarizationSlotState;
  job?: JobInfo;
};

export type DiarizationRouteRuntime = DiarizationRuntimeRoute & {
  slots: DiarizationRuntimeSlot[];
  overflowJobs: JobInfo[];
};

function normalizeUrl(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.replace(/\/+$/, "")
    : undefined;
}

function jobMatchesRoute(job: JobInfo, route: DiarizationRuntimeRoute) {
  const context = job.routingContext;
  if (context?.providerProfileId === route.id) return true;
  if (context?.providerProfileName === route.name) return true;
  const jobUrl = normalizeUrl(job.data?.diarizationServerUrl);
  const routeUrl = normalizeUrl(route.baseUrl);
  return Boolean(jobUrl && routeUrl && jobUrl === routeUrl);
}

function jobStateRank(job: JobInfo): number {
  if (job.state === "active") return 0;
  if (job.state === "waiting") return 1;
  if (job.state === "delayed") return 2;
  return 3;
}

function slotState(job: JobInfo | undefined, enabled: boolean) {
  if (job && job.queuePresent === false) return "stale" as const;
  if (job?.state === "active") return "processing" as const;
  if (job?.state === "waiting" || job?.state === "delayed") {
    return "queued" as const;
  }
  return enabled ? "idle" as const : "disabled" as const;
}

export function buildDiarizationRuntime(
  routes: DiarizationRuntimeRoute[],
  workerConcurrency: number,
  jobs: JobInfo[],
) {
  const liveJobs = jobs.filter((job) =>
    job.type === "diarization" &&
    ["active", "waiting", "delayed"].includes(job.state)
  );
  const assigned = new Set<string>();
  const routeRuntimes: DiarizationRouteRuntime[] = routes.map((route) => {
    const matching = liveJobs
      .filter((job) => jobMatchesRoute(job, route))
      .sort((a, b) =>
        jobStateRank(a) - jobStateRank(b) ||
        (a.timestamp ?? 0) - (b.timestamp ?? 0)
      );
    matching.forEach((job) => assigned.add(job.id));
    const capacity = Math.max(1, Math.floor(route.concurrency || 1));
    return {
      ...route,
      concurrency: capacity,
      slots: Array.from({ length: capacity }, (_, index) => {
        const job = matching[index];
        return {
          index: index + 1,
          state: slotState(job, route.enabled),
          ...(job ? { job } : {}),
        };
      }),
      overflowJobs: matching.slice(capacity),
    };
  });
  const configuredCapacity = routes
    .filter((route) => route.enabled)
    .reduce((sum, route) => sum + Math.max(1, route.concurrency || 1), 0);
  const staleJobs = liveJobs.filter((job) => job.queuePresent === false).length;
  const activeJobs =
    liveJobs.filter((job) =>
      job.state === "active" && job.queuePresent !== false
    ).length;
  const queuedJobs =
    liveJobs.filter((job) =>
      (job.state === "waiting" || job.state === "delayed") &&
      job.queuePresent !== false
    )
      .length;

  return {
    routes: routeRuntimes,
    configuredCapacity,
    workerConcurrency,
    activeJobs,
    queuedJobs,
    staleJobs,
    concurrencyMismatch: configuredCapacity > 0 &&
      configuredCapacity !== workerConcurrency,
    unmatchedJobs: liveJobs.filter((job) => !assigned.has(job.id)),
  };
}
