import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { ObjectId } from "bson";
import { redis } from "@/lib/redis.ts";
import { Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { getConfigResource } from "@/lib/config/resource.server.ts";
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
import { TranscriptionResource } from "@/lib/transcription/resource.server.ts";
import { selectTranscriptionProvider } from "@/lib/transcription/provider-routing.ts";
import {
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

const queues = new Map<string, Queue<JobData>>();
const queueEvents = new Map<string, QueueEvents>();

const LLM_ROUTED_JOB_TYPES = new Set([
  "summarization",
  "conversation_chunk_creator",
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

  if (!mergedData.routingContext) {
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
      // STT jobs require a concrete provider reservation. Preserve the real
      // health/slot error so TriggerManager can schedule a health retry instead
      // of replacing it with a misleading missing-snapshot error.
      if (
        data.type === "transcription" || LLM_ROUTED_JOB_TYPES.has(data.type)
      ) {
        throw error;
      }
      console.warn(
        `[queue] Could not snapshot routing context for ${data.type}:`,
        error,
      );
      mergedData.routingContext = { resolvedAt: new Date().toISOString() };
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
  if (DIARIZATION_ROUTED_JOB_TYPES.has(data.type)) {
    const diarizator = (await getExternalServicesHealth()).find((service) =>
      service.id === "diarizator"
    );
    const healthyIds = new Set(
      diarizator?.routes?.filter((route) => route.status === "healthy")
        .map((route) => route.providerProfileId)
        .filter((id): id is string => Boolean(id)) ?? [],
    );
    if (healthyIds.size === 0) {
      throw new Error(
        `No healthy diarizator route is available. ${
          diarizator?.message ?? "Configure one in Settings → Diarization."
        }`,
      );
    }
    const configResource = await getConfigResource(auth);
    const config = await configResource({ action: "get" });
    const routes = resolveDiarizatorRoutes(config);
    const load = await getDiarizatorProviderLoad();
    const requestedProviderId = reuseDiarizatorRoute
      ? mergedData.routingContext?.providerProfileId
      : undefined;
    const selected = selectDiarizatorRoute(
      routes,
      healthyIds,
      load,
      requestedProviderId,
    );
    if (!selected) {
      if (requestedProviderId) {
        const requested = routes.find((route) =>
          route.id === requestedProviderId
        );
        throw new Error(
          `Diarizator provider ${
            requested?.name ?? requestedProviderId
          } has no free concurrency slots`,
        );
      }
      throw new Error(
        "All healthy diarizator provider concurrency slots are reserved",
      );
    }
    const snapshot = buildDiarizatorJobSnapshot(
      {
        providerProfileId: selected.id,
        providerProfileName: selected.name,
        baseUrl: selected.baseUrl,
      },
      mergedData.routingContext,
      new Date().toISOString(),
    );
    mergedData.diarizationServerUrl = snapshot.diarizationServerUrl;
    mergedData.routingContext = snapshot.routingContext;
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

  await mongo({
    action: "insertOne",
    collection: "jobs",
    doc: {
      _id: new ObjectId(jobId),
      type: parsedData.type,
      data: parsedData,
      state: "waiting",
      attempts: 0,
      trigger: triggerWithPrincipal,
      ...(options?.restartedFromJobId
        ? { restartedFromJobId: options.restartedFromJobId }
        : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return queue.add(parsedData.type, parsedData, {
    priority: options?.priority,
    jobId,
  });
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
