import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { ObjectId } from "bson";
import { ExecutionError } from "redlock";
import { redis, redlock } from "@/lib/redis.ts";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getConfigResource } from "@/lib/config/resource.server.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { env } from "#/env.ts";
import type {
  EnqueueJobOptions,
  JobData,
  JobResult,
  JobRoutingContext,
} from "./types.ts";
export type { EnqueueJobOptions };
import { jobRegistry } from "./job-registry.ts";
import {
  assertJobServicesHealthy,
  getExternalServicesHealth,
} from "./service-health.ts";
import {
  applySummarizationDefaults,
  type SummarizationDefaults,
} from "./summarization-defaults.ts";
import { sanitizeEnqueueData } from "./enqueue-data.ts";
import { TranscriptionResource } from "@/lib/transcription/resource.server.ts";
import { selectTranscriptionProvider } from "@/lib/transcription/provider-routing.ts";
import {
  applyDiarizatorHealthConstraints,
  buildDiarizatorJobSnapshot,
  resolveDiarizatorRoutes,
  selectDiarizatorRoute,
} from "@/lib/diarization/provider-routing.ts";
import { assertDiarizationGenerationReady } from "@/lib/diarization/generation-preflight.ts";
import { LLMResource } from "@/lib/llm/resource.server.ts";
import {
  isLlmModelAlias,
  selectLlmJobProvider,
} from "@/lib/llm/provider-routing.ts";
import {
  DIARIZATOR_WAITING_FOR_SLOT,
  getDiarizatorAdmissionPriority,
  isDiarizatorSlotUnavailable,
} from "./diarizator-admission.ts";

const queues = new Map<string, Queue<JobData>>();
const queueEvents = new Map<string, QueueEvents>();

const LLM_ROUTED_JOB_TYPES = new Set([
  "summarization",
  "conversation_extractor_merged",
  "tagger",
  "entity_typing",
]);

const DIARIZATION_ROUTED_JOB_TYPES = new Set([
  "diarization",
  "enrollment",
  "profileReenrollment",
]);

const RESERVED_PROVIDER_JOB_STATES = [
  "active",
  "wait",
  "delayed",
  "paused",
  "prioritized",
] as const;

export const DIARIZATOR_ROUTE_ENQUEUE_LOCK_RESOURCE =
  "mycelia:lock:diarizator-route-enqueue:v1";
export const DIARIZATOR_ROUTE_ENQUEUE_LOCK_TTL_MS = 30_000;
export const DIARIZATOR_ROUTE_ENQUEUE_LOCK_ERROR =
  "Diarizator route reservation is temporarily busy";

// Some workers run long, externally-backed operations (for example Whisper
// batches). BullMQ's default 30s lock is too short for a busy Deno process or
// a brief Redis scheduling hiccup and can produce a false "could not renew
// lock" while the child process is still making progress.
const WORKER_LOCK_DURATION_MS = 10 * 60 * 1000;
const WORKER_LOCK_RENEW_TIME_MS = 60 * 1000;

function getQueueName(type: string): string {
  return `jobs-${type}`;
}

export function getQueue(type: string): Queue<JobData> {
  let queue = queues.get(type);
  if (!queue) {
    queue = new Queue<JobData>(getQueueName(type), {
      connection: redis,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: {
          count: 100,
          age: 24 * 3600,
        },
        removeOnFail: {
          count: 500,
          age: 7 * 24 * 3600,
        },
      },
    });
    queues.set(type, queue);
  }
  return queue;
}

export function getQueueEvents(type: string): QueueEvents {
  let events = queueEvents.get(type);
  if (!events) {
    events = new QueueEvents(getQueueName(type), {
      connection: redis,
    });
    queueEvents.set(type, events);
  }
  return events;
}

async function getDiarizatorProviderLoad(): Promise<Record<string, number>> {
  const reservedByQueue = await Promise.all(
    [...DIARIZATION_ROUTED_JOB_TYPES].map((type) =>
      getQueue(type).getJobs(
        [...RESERVED_PROVIDER_JOB_STATES],
        0,
        -1,
        true,
      )
    ),
  );
  const load: Record<string, number> = {};
  for (const job of reservedByQueue.flat()) {
    const profileId = job.data.routingContext?.providerProfileId;
    if (profileId) load[profileId] = (load[profileId] ?? 0) + 1;
  }
  return load;
}

export type DiarizatorRouteReservationDependencies = {
  getLoad?: () => Promise<Record<string, number>>;
  lockResource?: string;
};

type ReservationAbortSignal = AbortSignal & { error?: unknown };

function getReservationAbortError(
  signal?: ReservationAbortSignal,
): Error | undefined {
  if (!signal?.aborted) return undefined;
  const cause = signal.error ?? signal.reason;
  return new Error(DIARIZATOR_ROUTE_ENQUEUE_LOCK_ERROR, {
    ...(cause === undefined ? {} : { cause }),
  });
}

/**
 * Serialize route selection through the BullMQ commit that makes the selected
 * slot visible. The lock is pool-wide because capacity is shared by three
 * queues and route choice compares every provider in the pool.
 */
export async function reserveDiarizatorRouteAndCommit<T>(input: {
  routes: ReturnType<typeof resolveDiarizatorRoutes>;
  healthyIds: Set<string>;
  requestedProviderId?: string;
  commit: (
    selected: ReturnType<typeof resolveDiarizatorRoutes>[number],
    load: Record<string, number>,
    signal: ReservationAbortSignal,
  ) => Promise<T>;
}, dependencies: DiarizatorRouteReservationDependencies = {}): Promise<T> {
  const getLoad = dependencies.getLoad ?? getDiarizatorProviderLoad;
  const lockResource = dependencies.lockResource ??
    DIARIZATOR_ROUTE_ENQUEUE_LOCK_RESOURCE;
  let committed: { value: T } | undefined;

  try {
    return await redlock.using(
      [lockResource],
      DIARIZATOR_ROUTE_ENQUEUE_LOCK_TTL_MS,
      async (signal) => {
        const initialAbort = getReservationAbortError(signal);
        if (initialAbort) throw initialAbort;

        const load = await getLoad();
        const selected = selectDiarizatorRoute(
          input.routes,
          input.healthyIds,
          load,
          input.requestedProviderId,
        );
        if (!selected) {
          if (input.requestedProviderId) {
            const requested = input.routes.find((route) =>
              route.id === input.requestedProviderId
            );
            throw new Error(
              `Diarizator provider ${
                requested?.name ?? input.requestedProviderId
              } has no free concurrency slots`,
            );
          }
          throw new Error(
            "All healthy diarizator provider concurrency slots are reserved",
          );
        }

        const preCommitAbort = getReservationAbortError(signal);
        if (preCommitAbort) throw preCommitAbort;
        const value = await input.commit(selected, load, signal);
        committed = { value };
        return value;
      },
    );
  } catch (error) {
    // Redlock may report a release failure after the BullMQ add committed. The
    // lease will expire, and surfacing an enqueue failure here could cause the
    // caller to create a duplicate job, so preserve the committed result.
    if (committed) {
      console.warn(
        `[queue] ${DIARIZATOR_ROUTE_ENQUEUE_LOCK_ERROR} after the job committed; waiting for the lease to expire`,
        error,
      );
      return committed.value;
    }
    if (error instanceof ExecutionError) {
      throw new Error(DIARIZATOR_ROUTE_ENQUEUE_LOCK_ERROR, { cause: error });
    }
    throw error;
  }
}

type MongoOperation = (input: any) => Promise<any>;
export type QueuePersistence = Pick<Queue<JobData>, "add" | "getJob">;

async function markQueueEnqueueFailure(
  mongo: MongoOperation,
  publishUpdate: typeof publishJobUpdate,
  jobId: string,
  jobType: string,
  failedReason: string,
): Promise<void> {
  const failedAt = new Date();
  try {
    await mongo({
      action: "updateOne",
      collection: "jobs",
      query: { _id: new ObjectId(jobId), state: "waiting" },
      update: {
        $set: {
          state: "failed",
          failedReason,
          finishedAt: failedAt,
          updatedAt: failedAt,
        },
      },
    });
  } catch (error) {
    console.error(
      `[queue] Could not mark unqueued job ${jobId} as failed:`,
      error,
    );
    return;
  }

  try {
    await publishUpdate(jobId, jobType, "job.failed", {
      state: "failed",
      failedReason,
      finishedOn: failedAt.getTime(),
    });
  } catch (error) {
    // Mongo is canonical for job history; a transient websocket publication
    // failure must not undo or disguise the compensation.
    console.warn(
      `[queue] Could not publish enqueue failure for job ${jobId}:`,
      error,
    );
  }
}

async function addQueueJobWithReconciliation(input: {
  queue: QueuePersistence;
  jobId: string;
  jobData: JobData;
  priority?: number;
  reservationSignal?: ReservationAbortSignal;
  onDefiniteFailure?: (failedReason: string) => Promise<void>;
}): Promise<Job<JobData>> {
  // The Mongo write may be much slower than route selection. Do not issue a
  // retrying BullMQ command after Redlock has told us that another enqueuer may
  // own the pool lock. At this point queue absence is definite, so a newly
  // persisted row can be compensated immediately.
  const abortError = getReservationAbortError(input.reservationSignal);
  if (abortError) {
    await input.onDefiniteFailure?.(
      `queue_reservation_aborted: ${abortError.message}`,
    );
    throw abortError;
  }

  try {
    return await input.queue.add(input.jobData.type, input.jobData, {
      priority: input.priority,
      jobId: input.jobId,
      ...(input.jobData.type === "histRecalculation" &&
          input.jobData.timelineRebuildCampaignId
        ? {
          attempts: 5,
          backoff: { type: "exponential", delay: 30_000 },
        }
        : {}),
    });
  } catch (addError) {
    let existing: Job<JobData> | undefined;
    try {
      existing = await input.queue.getJob(input.jobId) ?? undefined;
    } catch (reconcileError) {
      // Redis could have accepted the atomic BullMQ add before the client saw
      // an error. Leave the waiting Mongo row for MaintenanceManager rather
      // than guessing and potentially contradicting a live queue record.
      console.warn(
        `[queue] Could not reconcile failed enqueue for job ${input.jobId}:`,
        reconcileError,
      );
      throw addError;
    }

    if (existing) {
      const expectedProvider = input.jobData.routingContext?.providerProfileId;
      const existingProvider = existing.data.routingContext?.providerProfileId;
      if (
        existing.data.type === input.jobData.type &&
        existingProvider === expectedProvider
      ) {
        console.warn(
          `[queue] Reconciled ambiguous enqueue response for existing job ${input.jobId}`,
        );
        return existing;
      }

      const conflictReason =
        `queue_job_id_conflict: existing ${existing.data.type}/${
          existingProvider ?? "unrouted"
        }, expected ${input.jobData.type}/${expectedProvider ?? "unrouted"}`;
      await input.onDefiniteFailure?.(conflictReason);
      throw new Error(conflictReason, { cause: addError });
    }

    const reason = addError instanceof Error
      ? addError.message
      : String(addError);
    await input.onDefiniteFailure?.(
      `queue_enqueue_failed: ${reason.slice(0, 500)}`,
    );
    throw addError;
  }
}

/** Persist the canonical job record, then commit its BullMQ reservation. */
export async function persistAndAddJobRecord(input: {
  mongo: MongoOperation;
  queue: QueuePersistence;
  jobId: string;
  parsedData: JobData;
  priority?: number;
  trigger: Record<string, unknown>;
  restartedFromJobId?: string;
  publishUpdate?: typeof publishJobUpdate;
  reservationSignal?: ReservationAbortSignal;
}): Promise<Job<JobData>> {
  const createdAt = new Date();
  await input.mongo({
    action: "insertOne",
    collection: "jobs",
    doc: {
      _id: new ObjectId(input.jobId),
      type: input.parsedData.type,
      data: input.parsedData,
      state: "waiting",
      ...(input.priority == null ? {} : { priority: input.priority }),
      attempts: 0,
      trigger: input.trigger,
      ...(input.restartedFromJobId
        ? { restartedFromJobId: input.restartedFromJobId }
        : {}),
      createdAt,
      updatedAt: createdAt,
    },
  });

  return await addQueueJobWithReconciliation({
    queue: input.queue,
    jobId: input.jobId,
    jobData: input.parsedData,
    priority: input.priority,
    reservationSignal: input.reservationSignal,
    onDefiniteFailure: (failedReason) =>
      markQueueEnqueueFailure(
        input.mongo,
        input.publishUpdate ?? publishJobUpdate,
        input.jobId,
        input.parsedData.type,
        failedReason,
      ),
  });
}

/**
 * Re-add a persisted routed job without changing its saved provider snapshot.
 * Maintenance recovery must compete for the same pool lock as new jobs; it
 * must never silently move an old job to a different diarizator.
 */
export async function reserveAndAddPersistedDiarizatorJob(input: {
  routes: ReturnType<typeof resolveDiarizatorRoutes>;
  healthyIds: Set<string>;
  queue: QueuePersistence;
  jobId: string;
  jobData: JobData;
  priority?: number;
}, dependencies: DiarizatorRouteReservationDependencies = {}): Promise<
  Job<JobData>
> {
  const savedProviderId = input.jobData.routingContext?.providerProfileId;
  if (!savedProviderId) {
    throw new Error(
      `Persisted ${input.jobData.type} job ${input.jobId} has no saved diarizator provider`,
    );
  }
  const savedRoute = input.routes.find((route) =>
    route.id === savedProviderId && route.enabled
  );
  if (!savedRoute) {
    throw new Error(
      `Saved diarizator provider ${savedProviderId} is disabled or no longer configured`,
    );
  }
  if (!input.healthyIds.has(savedProviderId)) {
    throw new Error(
      `Saved diarizator provider ${savedRoute.name} is not healthy`,
    );
  }

  return await reserveDiarizatorRouteAndCommit({
    routes: input.routes,
    healthyIds: input.healthyIds,
    requestedProviderId: savedProviderId,
    commit: async (_selected, _load, signal) =>
      await addQueueJobWithReconciliation({
        queue: input.queue,
        jobId: input.jobId,
        jobData: input.jobData,
        priority: input.priority,
        reservationSignal: signal,
      }),
  }, dependencies);
}

/** Requeue the canonical waiting row under any provider reservation it needs. */
export async function requeuePersistedJob(input: {
  jobId: string;
  jobType: string;
  jobData: JobData;
  priority?: number;
}, authOverride?: Auth): Promise<Job<JobData>> {
  if (input.jobData.type !== input.jobType) {
    throw new Error(
      `Persisted job ${input.jobId} type mismatch: row=${input.jobType}, data=${input.jobData.type}`,
    );
  }

  const queue = getQueue(input.jobType);
  if (!DIARIZATION_ROUTED_JOB_TYPES.has(input.jobType)) {
    return await addQueueJobWithReconciliation({
      queue,
      jobId: input.jobId,
      jobData: input.jobData,
    });
  }

  const auth = authOverride ?? await getServerAuth();
  const configResource = await getConfigResource(auth);
  const [services, config] = await Promise.all([
    getExternalServicesHealth(),
    configResource({ action: "get" }),
  ]);
  const diarizator = services.find((service) => service.id === "diarizator");
  const healthyIds = new Set(
    diarizator?.routes?.filter((route) => route.status === "healthy")
      .map((route) => route.providerProfileId)
      .filter((id): id is string => Boolean(id)) ?? [],
  );

  const routes = applyDiarizatorHealthConstraints(
    resolveDiarizatorRoutes(config),
    diarizator?.routes,
  );
  const savedProviderId = input.jobData.routingContext?.providerProfileId;
  if (!savedProviderId) {
    const mongo = await getMongoResource(auth);
    return await reserveDiarizatorRouteAndCommit({
      routes,
      healthyIds,
      commit: async (selected, _load, signal) => {
        const snapshot = buildDiarizatorJobSnapshot(
          {
            providerProfileId: selected.id,
            providerProfileName: selected.name,
            baseUrl: selected.baseUrl,
          },
          input.jobData.routingContext,
          new Date().toISOString(),
        );
        const routedData = jobRegistry.validateJobData({
          ...input.jobData,
          diarizationServerUrl: snapshot.diarizationServerUrl,
          routingContext: snapshot.routingContext,
        });
        await mongo({
          action: "updateOne",
          collection: "jobs",
          query: { _id: new ObjectId(input.jobId), state: "waiting" },
          update: {
            $set: {
              data: routedData,
              routingContext: snapshot.routingContext,
              "queueAdmission.state": "admitted",
              "queueAdmission.admittedAt": new Date(),
              updatedAt: new Date(),
            },
          },
        });
        return await addQueueJobWithReconciliation({
          queue,
          jobId: input.jobId,
          jobData: routedData,
          priority: input.priority,
          reservationSignal: signal,
        });
      },
    });
  }

  return await reserveAndAddPersistedDiarizatorJob({
    routes,
    healthyIds,
    queue,
    jobId: input.jobId,
    // Preserve legacy snapshots exactly. In particular, do not inject a new
    // maxSequenceChunks value into jobs whose timeout must remain 15 minutes.
    jobData: input.jobData,
    priority: input.priority,
  });
}

async function persistDeferredDiarizatorJob(input: {
  mongo: MongoOperation;
  jobId: string;
  parsedData: JobData;
  priority: number;
  trigger: Record<string, unknown>;
  requestedProviderId?: string;
  restartedFromJobId?: string;
  reason: string;
}): Promise<Job<JobData>> {
  const createdAt = new Date();
  await input.mongo({
    action: "insertOne",
    collection: "jobs",
    doc: {
      _id: new ObjectId(input.jobId),
      type: input.parsedData.type,
      data: input.parsedData,
      state: "waiting",
      priority: input.priority,
      attempts: 0,
      trigger: input.trigger,
      queueAdmission: {
        state: DIARIZATOR_WAITING_FOR_SLOT,
        reason: input.reason,
        priority: input.priority,
        requestedProviderId: input.requestedProviderId,
        queuedAt: createdAt,
      },
      ...(input.restartedFromJobId
        ? { restartedFromJobId: input.restartedFromJobId }
        : {}),
      createdAt,
      updatedAt: createdAt,
    },
  });
  // Callers only require the stable id/data reference. The common admission
  // reconciler will create the real BullMQ record when a route slot is free.
  return {
    id: input.jobId,
    data: input.parsedData,
    opts: { priority: input.priority },
  } as Job<JobData>;
}

export async function enqueueJob(
  data: JobData,
  options?: EnqueueJobOptions,
  authOverride?: Auth,
): Promise<Job<JobData>> {
  const jobId = options?.jobId || new ObjectId().toString();
  const auth = authOverride || await getServerAuth();
  const mongo = await getMongoResource(auth);

  // Resolve the selected prompt document at enqueue time. Each job keeps a
  // reproducible snapshot while config remains the source of truth for new jobs.
  const summarizationDefaults: SummarizationDefaults = {};
  if (data.type === "summarization") {
    const config = await mongo({
      action: "findOne",
      collection: "configs",
      query: { _id: new ObjectId("000000000000000000000000") },
      options: {
        projection: { prompts: 1, llm: 1, inference: 1, llmProfiles: 1 },
      },
    });
    // The highest-priority enabled profile supplies the default alias.
    const primaryProfile = ((config?.llmProfiles?.profiles ?? []) as any[])
      .filter((profile) => profile.enabled ?? true)
      .sort((a, b) =>
        (a.priority ?? 50) - (b.priority ?? 50) ||
        String(a.name ?? "").localeCompare(String(b.name ?? "")) ||
        String(a.id ?? "").localeCompare(String(b.id ?? ""))
      )[0];
    summarizationDefaults.defaultModel = primaryProfile?.defaultAlias ||
      config?.llm?.model || config?.inference?.model || "small";

    const promptId = config?.prompts?.summarization_system;
    if (promptId) {
      const prompt = await mongo({
        action: "findOne",
        collection: "prompts",
        query: { _id: promptId },
        options: { projection: { name: 1, text: 1 } },
      });
      if (prompt?.name && prompt?.text) {
        summarizationDefaults.prompt = {
          id: prompt._id?.toString(),
          name: prompt.name,
          text: prompt.text,
        };
      }
    }
  }

  // Explicit input wins. The configured prompt supersedes the legacy copied
  // prompt text in worker defaults, then remaining worker defaults are applied.
  let mergedData = { ...data };
  if (data.type === "transcription") {
    let batchSize = env.TRANSCRIPTION_BATCH_SIZE;
    let batchTimeoutBaseSeconds = 120;
    let batchTimeoutPerSequenceSeconds = 60;
    try {
      const configResource = await getConfigResource(auth);
      const transcriptionConfig = await configResource({
        action: "get",
        path: "transcription",
      }) as {
        batchSize?: unknown;
        batchTimeoutBaseSeconds?: unknown;
        batchTimeoutPerSequenceSeconds?: unknown;
      } | undefined;
      const configuredBatchSize = Number(transcriptionConfig?.batchSize);
      if (
        Number.isInteger(configuredBatchSize) && configuredBatchSize >= 1 &&
        configuredBatchSize <= 32
      ) {
        batchSize = configuredBatchSize;
      }
      const configuredBase = Number(
        transcriptionConfig?.batchTimeoutBaseSeconds,
      );
      if (
        Number.isInteger(configuredBase) && configuredBase >= 60 &&
        configuredBase <= 1800
      ) {
        batchTimeoutBaseSeconds = configuredBase;
      }
      const configuredPerSequence = Number(
        transcriptionConfig?.batchTimeoutPerSequenceSeconds,
      );
      if (
        Number.isInteger(configuredPerSequence) &&
        configuredPerSequence >= 15 && configuredPerSequence <= 300
      ) {
        batchTimeoutPerSequenceSeconds = configuredPerSequence;
      }
    } catch (error) {
      if (data.type === "transcription") {
        throw error;
      }
      console.warn(
        "[queue] Could not read transcription batch settings; using defaults:",
        error,
      );
    }
    if (mergedData.batchSize === undefined) mergedData.batchSize = batchSize;
    if (mergedData.batchTimeoutBaseSeconds === undefined) {
      mergedData.batchTimeoutBaseSeconds = batchTimeoutBaseSeconds;
    }
    if (mergedData.batchTimeoutPerSequenceSeconds === undefined) {
      mergedData.batchTimeoutPerSequenceSeconds =
        batchTimeoutPerSequenceSeconds;
    }
  }
  if (data.type) {
    const { workerDiscovery } = await import("./worker-discovery.ts");
    const defaultOverrides = await workerDiscovery.getDefaultOverrides(
      data.type,
    );
    if (data.type === "summarization") {
      mergedData = applySummarizationDefaults(
        data,
        defaultOverrides,
        summarizationDefaults,
      );
    } else if (defaultOverrides) {
      for (const [key, value] of Object.entries(defaultOverrides)) {
        if (!(key in mergedData) || mergedData[key] === undefined) {
          mergedData[key] = value;
        }
      }
    }
  }
  mergedData = sanitizeEnqueueData(mergedData);

  const needsPrimaryRouting = data.type === "transcription" ||
    LLM_ROUTED_JOB_TYPES.has(data.type);
  if (!mergedData.routingContext && needsPrimaryRouting) {
    try {
      const configResource = await getConfigResource(auth);
      const config = await configResource({ action: "get" }) as any;
      const workerConfig = config?.workers?.[data.type] ?? {};
      // Routing is priority-based: snapshot the route expected to serve this
      // job's model. Providers that advertise an explicitly requested model
      // outrank blind candidates so the label matches what actually runs.
      // Per-request failover may still use another provider; provenance
      // records the actual one.
      const jobModel = typeof mergedData.model === "string"
        ? mergedData.model.trim()
        : "";
      const isAlias = isLlmModelAlias(jobModel);
      // Use the same fully resolved provider list as the LLM resource itself.
      // This includes the optional environment route and legacy fallback, so
      // enqueue validation cannot reject a route that completions can serve.
      const enabledProfiles = (await new LLMResource().getInferenceProviders())
        .filter((profile) => profile.enabled);
      const requestedProviderId = typeof mergedData.providerProfileId ===
            "string" && mergedData.providerProfileId.trim()
        ? mergedData.providerProfileId.trim()
        : typeof workerConfig.routingContext?.providerProfileId === "string"
        ? workerConfig.routingContext.providerProfileId.trim()
        : undefined;
      const requestedProvider = requestedProviderId
        ? enabledProfiles.find((profile) => profile.id === requestedProviderId)
        : undefined;
      const primaryProfile = selectLlmJobProvider(
        enabledProfiles,
        jobModel,
        requestedProviderId,
      );
      if (LLM_ROUTED_JOB_TYPES.has(data.type)) {
        if (requestedProviderId && !requestedProvider) {
          throw new Error(
            `Selected LLM provider "${requestedProviderId}" is disabled or no longer configured`,
          );
        }
        if (
          requestedProvider && isAlias &&
          !requestedProvider.aliases?.[jobModel]
        ) {
          throw new Error(
            `Selected LLM provider "${requestedProvider.name}" does not map alias "${jobModel}"`,
          );
        }
        if (!primaryProfile) {
          throw new Error(
            jobModel && !isAlias
              ? `Exact LLM model "${jobModel}" is not mapped by any enabled provider. Choose it from a provider or use a small/medium/large alias.`
              : "All LLM provider routes are disabled",
          );
        }
        // Exact model names are provider-specific. Persist the resolved
        // provider in the worker input so the LLM call cannot leak that name
        // to an unrelated failover route.
        if (jobModel && !isAlias && !requestedProviderId) {
          mergedData.providerProfileId = primaryProfile.id;
        }
      }
      let routingContext: JobRoutingContext;
      if (data.type === "transcription") {
        const configuredProviders = (await new TranscriptionResource()
          .getInferenceProviders()).filter((provider) => provider.enabled);
        if (configuredProviders.length === 0) {
          throw new Error("No enabled STT provider profiles are configured");
        }
        const sttHealth = (await getExternalServicesHealth()).find((service) =>
          service.id === "stt"
        );
        const healthyProfileIds = new Set(
          sttHealth?.routes?.filter((route) => route.status === "healthy")
            .map((route) => route.providerProfileId) ?? [],
        );
        const providers = sttHealth?.routes?.length
          ? configuredProviders.filter((provider) =>
            healthyProfileIds.has(provider.id)
          )
          : configuredProviders;
        if (providers.length === 0) {
          throw new Error("No healthy STT provider profiles are available");
        }
        const transcriptionQueue = getQueue("transcription");
        const reservedJobs = await transcriptionQueue.getJobs(
          [...RESERVED_PROVIDER_JOB_STATES],
          0,
          -1,
          true,
        );
        const load: Record<string, number> = {};
        for (const reservedJob of reservedJobs) {
          const profileId = reservedJob.data.routingContext?.providerProfileId;
          if (profileId) load[profileId] = (load[profileId] ?? 0) + 1;
        }
        const provider = selectTranscriptionProvider(providers, load);
        if (!provider) {
          throw new Error(
            "All enabled STT provider concurrency slots are reserved",
          );
        }
        routingContext = {
          ...(workerConfig.presetId ? { presetId: workerConfig.presetId } : {}),
          sourceId: `stt:${provider.id}`,
          providerProfileId: provider.id,
          providerProfileName: provider.name,
          model: provider.model,
          resolvedAt: new Date().toISOString(),
        };
      } else {
        routingContext = {
          ...(workerConfig.presetId ? { presetId: workerConfig.presetId } : {}),
          ...(workerConfig.routingContext?.sourceId
            ? { sourceId: workerConfig.routingContext.sourceId }
            : {}),
          providerProfileId: requestedProviderId ?? primaryProfile?.id,
          providerProfileName: primaryProfile?.name,
          model: typeof mergedData.model === "string"
            ? mergedData.model
            : undefined,
          resolvedAt: new Date().toISOString(),
        };
      }
      mergedData.routingContext = routingContext;
    } catch (error) {
      // Routed jobs require a concrete provider reservation. Preserve the real
      // health/slot error so TriggerManager can schedule a health retry.
      throw error;
    }
  }

  if (data.type === "transcription") {
    const providerProfileId = mergedData.routingContext?.providerProfileId;
    if (!providerProfileId) {
      throw new Error(
        "Transcription job is missing its provider routing snapshot",
      );
    }
    const provider = await new TranscriptionResource().getInferenceProvider(
      providerProfileId,
    );
    if (!provider) {
      throw new Error(`STT provider profile not found: ${providerProfileId}`);
    }
    const reservedJobs = await getQueue("transcription").getJobs(
      [...RESERVED_PROVIDER_JOB_STATES],
      0,
      -1,
      true,
    );
    const reservedForProvider = reservedJobs.filter((job) =>
      job.data.routingContext?.providerProfileId === providerProfileId
    ).length;
    if (reservedForProvider >= provider.concurrency) {
      throw new Error(
        `STT provider ${provider.name} has no free concurrency slots`,
      );
    }
  }

  const reuseDiarizatorRoute = options?.reuseHealthyRoute === true &&
    data.type === "diarization" &&
    typeof mergedData.diarizationServerUrl === "string" &&
    Boolean(mergedData.routingContext?.providerProfileId);
  let diarizatorRoutes: ReturnType<typeof resolveDiarizatorRoutes> | undefined;
  let healthyDiarizatorIds: Set<string> | undefined;
  let requestedDiarizatorProviderId: string | undefined;
  if (DIARIZATION_ROUTED_JOB_TYPES.has(data.type)) {
    const diarizator = (await getExternalServicesHealth()).find((service) =>
      service.id === "diarizator"
    );
    healthyDiarizatorIds = new Set(
      diarizator?.routes?.filter((route) => route.status === "healthy")
        .map((route) => route.providerProfileId)
        .filter((id): id is string => Boolean(id)) ?? [],
    );
    if (healthyDiarizatorIds.size === 0) {
      throw new Error(
        `No healthy diarizator route is available. ${
          diarizator?.message ?? "Configure one in Settings → Diarization."
        }`,
      );
    }
    const configResource = await getConfigResource(auth);
    const config = await configResource({ action: "get" });
    diarizatorRoutes = applyDiarizatorHealthConstraints(
      resolveDiarizatorRoutes(config),
      diarizator?.routes,
    );
    requestedDiarizatorProviderId = reuseDiarizatorRoute
      ? mergedData.routingContext?.providerProfileId
      : undefined;
  }

  const parsedData = jobRegistry.validateJobData(mergedData);

  if (!parsedData.type) {
    throw new Error(
      `Job data is missing 'type' field after validation for job ID: ${jobId}. Check if the schema for this job type includes the 'type' field.`,
    );
  }

  if (
    parsedData.type === "diarization" &&
    parsedData.mode === "build_generation"
  ) {
    const run = parsedData.runId
      ? await mongo({
        action: "findOne",
        collection: "diarization_runs",
        query: { runId: parsedData.runId },
        options: { projection: { runId: 1, status: 1 } },
      })
      : null;
    assertDiarizationGenerationReady(parsedData, run);
  }

  // Do not create a stream of doomed jobs while a required remote provider is
  // down or still loading. Periodic/startup triggers will retry the underlying
  // domain work after the provider becomes healthy.
  if (!reuseDiarizatorRoute) {
    await assertJobServicesHealthy(parsedData.type);
  }

  const queue = getQueue(parsedData.type);

  // Store in MongoDB
  const trigger = options?.trigger || { type: "manual" };
  const triggerWithPrincipal = {
    ...trigger,
    principal: auth.principal,
  };
  const diarizatorPriority = DIARIZATION_ROUTED_JOB_TYPES.has(parsedData.type)
    ? getDiarizatorAdmissionPriority(parsedData, options?.priority)
    : options?.priority;

  const persist = (
    finalData: JobData,
    reservationSignal?: ReservationAbortSignal,
  ) =>
    persistAndAddJobRecord({
      mongo,
      queue,
      jobId,
      parsedData: finalData,
      priority: diarizatorPriority,
      trigger: triggerWithPrincipal,
      restartedFromJobId: options?.restartedFromJobId,
      reservationSignal,
    });

  if (diarizatorRoutes && healthyDiarizatorIds) {
    const priority = diarizatorPriority ?? 20;
    const olderHigherPriority = await mongo({
      action: "findOne",
      collection: "jobs",
      query: {
        state: "waiting",
        "queueAdmission.state": DIARIZATOR_WAITING_FOR_SLOT,
        priority: { $lte: priority },
      },
      options: { projection: { _id: 1 }, sort: { priority: 1, createdAt: 1 } },
    });
    if (olderHigherPriority) {
      return await persistDeferredDiarizatorJob({
        mongo,
        jobId,
        parsedData,
        priority,
        trigger: triggerWithPrincipal,
        requestedProviderId: requestedDiarizatorProviderId,
        restartedFromJobId: options?.restartedFromJobId,
        reason: "A higher-priority diarizator job is already waiting",
      });
    }
    try {
      return await reserveDiarizatorRouteAndCommit({
        routes: diarizatorRoutes,
        healthyIds: healthyDiarizatorIds,
        requestedProviderId: requestedDiarizatorProviderId,
        commit: async (selected, load, signal) => {
          const snapshot = buildDiarizatorJobSnapshot(
            {
              providerProfileId: selected.id,
              providerProfileName: selected.name,
              baseUrl: selected.baseUrl,
            },
            parsedData.routingContext,
            new Date().toISOString(),
          );
          const routedData = jobRegistry.validateJobData({
            ...parsedData,
            diarizationServerUrl: snapshot.diarizationServerUrl,
            routingContext: snapshot.routingContext,
          });
          const job = await persist(routedData, signal);
          console.info(
            `[queue] Reserved diarizator route ${selected.name} for job ${jobId}`,
            {
              providerProfileId: selected.id,
              loadBefore: load[selected.id] ?? 0,
              concurrency: selected.concurrency,
            },
          );
          return job;
        },
      });
    } catch (error) {
      if (!isDiarizatorSlotUnavailable(error)) throw error;
      return await persistDeferredDiarizatorJob({
        mongo,
        jobId,
        parsedData,
        priority,
        trigger: triggerWithPrincipal,
        requestedProviderId: requestedDiarizatorProviderId,
        restartedFromJobId: options?.restartedFromJobId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return await persist(parsedData);
}

export async function getJob(
  type: string,
  jobId: string,
): Promise<Job<JobData> | null> {
  const queue = getQueue(type);
  const job = await queue.getJob(jobId);
  return job || null;
}

export function createWorker(
  type: string,
  processor: (job: Job<JobData>) => Promise<JobResult>,
  concurrency = 1,
): Worker<JobData, JobResult> {
  return new Worker<JobData, JobResult>(
    getQueueName(type),
    processor,
    {
      connection: redis,
      concurrency,
      lockDuration: WORKER_LOCK_DURATION_MS,
      lockRenewTime: WORKER_LOCK_RENEW_TIME_MS,
    },
  );
}
