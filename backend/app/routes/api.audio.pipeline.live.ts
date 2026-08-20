import type { Request, Response } from "express";
import { EJSON } from "bson";
import { authenticateOr401 } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getQueue } from "@/lib/jobs/queue.ts";
import { getExternalServicesHealth } from "@/lib/jobs/service-health.ts";
import { getWorkerRuntimeStatus } from "@/lib/jobs/workers.ts";
import {
  type DiarizationCampaignSummary,
  getDiarizationCampaignSummary,
} from "@/routes/api.audio.pipeline.ts";

const LIVE_JOB_STATES = [
  "active",
  "waiting",
  "delayed",
  "paused",
  "prioritized",
  "waiting-children",
] as const;

interface LiveDiarizationJob {
  id: string | undefined;
  state: string;
  campaignId?: string;
  providerProfileId?: string;
  progress: unknown;
  processedOn?: number;
}

function finitePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function progressRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Sum the end-to-end average rate of every reporting task in the active
 * campaign. Each task contributes its completed chunks divided by its current
 * BullMQ runtime, so a stalled task's contribution decays instead of leaving a
 * stale optimistic rate. This uses queue state already loaded by the live
 * endpoint and does not add Mongo polling.
 */
export function applyActiveDiarizationRate(
  campaign: DiarizationCampaignSummary | null,
  jobs: LiveDiarizationJob[],
  checkedAt: Date,
): DiarizationCampaignSummary | null {
  if (!campaign) return null;

  const activeCampaignJobs = jobs.filter((job) => {
    if (job.state !== "active") return false;
    const progress = progressRecord(job.progress);
    const campaignId = typeof progress?.campaignId === "string"
      ? progress.campaignId
      : job.campaignId;
    return campaignId === campaign.campaignId;
  });
  if (activeCampaignJobs.length === 0) return campaign;

  const reportingJobs = activeCampaignJobs.flatMap((job) => {
    const progress = progressRecord(job.progress);
    const chunks = finitePositiveNumber(progress?.batch_chunks_processed);
    if (chunks == null) return [];

    const currentElapsed = typeof job.processedOn === "number"
      ? Math.max((checkedAt.getTime() - job.processedOn) / 1_000, 0)
      : 0;
    const reportedElapsed = finitePositiveNumber(progress?.elapsed_seconds) ??
      0;
    const elapsedSeconds = Math.max(currentElapsed, reportedElapsed, 1);
    const chunksPerSecond = chunks / elapsedSeconds;
    if (!Number.isFinite(chunksPerSecond) || chunksPerSecond <= 0) return [];

    return [{
      chunks,
      chunksPerSecond,
      providerProfileId: job.providerProfileId,
    }];
  });
  if (reportingJobs.length === 0) {
    return {
      ...campaign,
      activeRateJobCount: activeCampaignJobs.length,
      activeRateReportingJobCount: 0,
      activeRateLaneCount: 0,
    };
  }

  const chunksPerSecond = reportingJobs.reduce(
    (total, job) => total + job.chunksPerSecond,
    0,
  );
  const inFlightProcessedChunks = reportingJobs.reduce(
    (total, job) => total + job.chunks,
    0,
  );
  const pendingForEta = campaign.pendingChunks == null
    ? null
    : Math.max(campaign.pendingChunks - inFlightProcessedChunks, 0);
  const activeRateLaneCount = new Set(
    reportingJobs.map((job) => job.providerProfileId).filter(Boolean),
  ).size;

  return {
    ...campaign,
    chunksPerSecond,
    etaSeconds: pendingForEta == null
      ? campaign.etaSeconds
      : pendingForEta / chunksPerSecond,
    rateStatus: "live",
    activeRateJobCount: activeCampaignJobs.length,
    activeRateReportingJobCount: reportingJobs.length,
    activeRateLaneCount: activeRateLaneCount || reportingJobs.length,
  };
}

function positiveConcurrency(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 1;
}

export async function apiAudioPipelineLiveHandler(
  req: Request,
  res: Response,
) {
  const auth = await authenticateOr401(req, res);
  const mongo = getMongoResource(auth);
  const warnings: string[] = [];
  const checkedAt = new Date();

  const campaignPromise = getDiarizationCampaignSummary(mongo).catch(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`campaign: ${message}`);
      return null;
    },
  );

  const queuePromise = getQueue("diarization")
    .getJobs([...LIVE_JOB_STATES], 0, 99, true)
    .then(async (jobs) => {
      const resolved = await Promise.all(
        jobs.map(async (job) => ({
          id: job.id,
          state: await job.getState(),
          campaignId: typeof job.data.campaignId === "string"
            ? job.data.campaignId
            : undefined,
          providerProfileId: job.data.routingContext?.providerProfileId,
          progress: job.progress,
          timestamp: job.timestamp,
          processedOn: job.processedOn,
        })),
      );
      const waitingStates = new Set([
        "waiting",
        "paused",
        "prioritized",
        "waiting-children",
      ]);
      return {
        available: true,
        active: resolved.filter((job) => job.state === "active").length,
        waiting: resolved.filter((job) => waitingStates.has(job.state)).length,
        delayed: resolved.filter((job) => job.state === "delayed").length,
        jobs: resolved,
      };
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`job queue: ${message}`);
      return {
        available: false,
        active: null,
        waiting: null,
        delayed: null,
        jobs: [],
      };
    });

  const capacityPromise = getExternalServicesHealth()
    .then((services) => {
      const diarizator = services.find((service) =>
        service.id === "diarizator"
      );
      const routes = diarizator?.routes ?? [];
      const enabledRoutes = routes.filter((route) => route.enabled);
      const healthyRoutes = enabledRoutes.filter((route) =>
        route.status === "healthy"
      );
      return {
        available: true,
        status: diarizator?.status ?? "disabled",
        enabledRoutes: enabledRoutes.length,
        enabledSlots: enabledRoutes.reduce(
          (total, route) => total + positiveConcurrency(route.concurrency),
          0,
        ),
        healthyRoutes: healthyRoutes.length,
        healthySlots: healthyRoutes.reduce(
          (total, route) => total + positiveConcurrency(route.concurrency),
          0,
        ),
        routes: routes.map((route) => ({
          id: route.providerProfileId,
          name: route.providerProfileName,
          enabled: route.enabled,
          status: route.status,
          concurrency: positiveConcurrency(route.concurrency),
          message: route.message,
        })),
        worker: getWorkerRuntimeStatus("diarization"),
      };
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`route capacity: ${message}`);
      return {
        available: false,
        status: "unavailable",
        enabledRoutes: null,
        enabledSlots: null,
        healthyRoutes: null,
        healthySlots: null,
        routes: [],
        worker: getWorkerRuntimeStatus("diarization"),
      };
    });

  const persistedJobsPromise = mongo({
    action: "find",
    collection: "jobs",
    query: {
      type: "diarization",
      state: { $in: ["active", "waiting", "delayed"] },
      dismissedAt: { $exists: false },
    },
    options: {
      projection: { _id: 1 },
      sort: { updatedAt: -1, createdAt: -1 },
      limit: 100,
      maxTimeMS: 1_000,
    },
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`persisted jobs: ${message}`);
    return [];
  }) as Promise<Array<{ _id: unknown }>>;

  const [campaign, queue, capacity, persistedJobs] = await Promise.all([
    campaignPromise,
    queuePromise,
    capacityPromise,
    persistedJobsPromise,
  ]);
  const liveIds = new Set(queue.jobs.map((job) => String(job.id)));
  const stalePersistedJobs =
    persistedJobs.filter((job) => !liveIds.has(String(job._id))).length;

  const campaignWithLiveRate = applyActiveDiarizationRate(
    campaign,
    queue.jobs,
    checkedAt,
  );

  res.json(EJSON.serialize({
    checkedAt,
    warnings,
    campaign: campaignWithLiveRate,
    jobs: {
      available: queue.available,
      active: queue.active,
      waiting: queue.waiting,
      delayed: queue.delayed,
      stalePersistedJobs,
      activeLanes: queue.jobs
        .filter((job) => job.state === "active")
        .map((job) => job.providerProfileId)
        .filter(Boolean),
    },
    capacity,
  }));
}
