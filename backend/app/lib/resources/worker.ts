import { z } from "zod";
import { ObjectId } from "bson";
import { type Auth, getServerAuth } from "@/lib/auth/core.server.ts";
import type { Resource, ResourcePath } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { jobRegistry } from "@/lib/jobs/job-registry.ts";
import { enqueueJob, EnqueueJobOptions, getQueue } from "@/lib/jobs/queue.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { workerPauseManager } from "@/lib/jobs/worker-pause-manager.ts";
import { getConfigResource } from "@/lib/config/resource.server.ts";
import { env } from "#/env.ts";
import {
  assertJobServicesHealthy,
  getExternalServicesHealth,
} from "@/lib/jobs/service-health.ts";
import { cancelRunningJob } from "@/lib/jobs/processor.ts";

const UpdateProgressSchema = z.object({
  action: z.literal("progressUpdate"),
  jobId: z.string(),
  progress: z.record(z.string(), z.any()),
});

const ListJobsSchema = z.object({
  action: z.literal("list"),
  types: z.array(z.string()).nullable().optional(),
  statuses: z
    .array(
      z.enum([
        "active",
        "waiting",
        "completed",
        "failed",
        "delayed",
        "paused",
      ]),
    )
    .nullable()
    .optional(),
  limit: z.number().optional(),
});

const CancelAllJobsSchema = z.object({
  action: z.literal("cancel_all"),
});

const ClearCompletedJobsSchema = z.object({
  action: z.literal("clear_completed"),
});

const ClearFailedJobsSchema = z.object({
  action: z.literal("clear_failed"),
  workerType: z.string(),
});

const ClearQueueSchema = z.object({
  action: z.literal("clear_queue"),
  workerType: z.string(),
});

const ResetWorkerSchema = z.object({
  action: z.literal("reset_worker"),
  workerType: z.string(),
  restart: z.boolean().optional().default(false),
});

const CancelJobSchema = z.object({
  action: z.literal("cancel"),
  id: z.string(),
});

const DismissFailedJobSchema = z.object({
  action: z.literal("dismiss_failed"),
  id: z.string(),
  reason: z.string().max(500).optional(),
});

const GetJobSchema = z.object({
  action: z.literal("get"),
  id: z.string(),
});

interface JobModelProvenanceEntry {
  stage: string;
  requestedModel?: string;
  executedModel?: string;
  responseModel?: string;
  fallbackModel?: string;
  fallbackUsed: boolean;
  providerBaseUrl?: string;
  providerProfileId?: string;
  providerProfileName?: string;
  provenanceQuality: "exact" | "requested_only";
}

function addModelProvenanceEntry(
  entries: JobModelProvenanceEntry[],
  value: Record<string, any> | null | undefined,
  stage: string,
) {
  if (!value) return;

  const requestedModel = value.requestedModel || value.model;
  const executedModel = value.resolvedModel || value.responseModel;
  if (!requestedModel && !executedModel) return;

  const entry: JobModelProvenanceEntry = {
    stage,
    requestedModel,
    executedModel,
    responseModel: value.responseModel,
    fallbackModel: value.fallbackModel,
    fallbackUsed: value.fallbackUsed === true,
    providerBaseUrl: value.providerBaseUrl,
    providerProfileId: value.providerProfileId,
    providerProfileName: value.providerProfileName,
    provenanceQuality: executedModel ? "exact" : "requested_only",
  };
  const key = JSON.stringify(entry);
  if (!entries.some((candidate) => JSON.stringify(candidate) === key)) {
    entries.push(entry);
  }
}

const EnqueueJobSchema = z.object({
  action: z.literal("enqueue"),
  data: z.object({ type: z.string() }).passthrough(),
  priority: z.number().optional(),
  trigger: z.object({
    type: z.enum(["manual", "auto"]),
    reason: z.string().optional(),
  }).optional(),
});

const SchemasSchema = z.object({
  action: z.literal("schemas"),
});

const PauseWorkerSchema = z.object({
  action: z.literal("pause_worker"),
  workerType: z.string(),
});

const ResumeWorkerSchema = z.object({
  action: z.literal("resume_worker"),
  workerType: z.string(),
});

const PauseAllSchema = z.object({
  action: z.literal("pause_all"),
});

const ResumeAllSchema = z.object({
  action: z.literal("resume_all"),
});

const GetWorkerStatusSchema = z.object({
  action: z.literal("get_worker_status"),
});

const ListWorkersSchema = z.object({
  action: z.literal("list_workers"),
});

const GetWorkerDefaultsSchema = z.object({
  action: z.literal("get_worker_defaults"),
  workerType: z.string(),
});

const UpdateWorkerDefaultsSchema = z.object({
  action: z.literal("update_worker_defaults"),
  workerType: z.string(),
  defaults: z.record(z.string(), z.any()),
});

const StatsSchema = z.object({
  action: z.literal("stats"),
});

const PipelineHealthSchema = z.object({
  action: z.literal("pipeline_health"),
  force: z.boolean().optional(),
});

const RetryFailedJobsSchema = z.object({
  action: z.literal("retry_failed"),
  workerType: z.string(),
  limit: z.number().int().min(1).max(100).default(25),
});

const ModelArtifactTypeSchema = z.enum([
  "summary",
  "conversation_extraction",
  "tagging",
]);

const ModelArtifactsSchema = z.object({
  action: z.literal("model_artifacts"),
  artifactTypes: z.array(ModelArtifactTypeSchema).optional(),
  model: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

const ReprocessModelArtifactsSchema = z.object({
  action: z.literal("reprocess_model_artifacts"),
  artifactType: z.literal("summary"),
  sourceModel: z.string().min(1),
  targetModel: z.string().min(1),
  artifactIds: z.array(z.string()).max(100).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const RequestSchema = z.union([
  UpdateProgressSchema,
  ListJobsSchema,
  CancelAllJobsSchema,
  ClearCompletedJobsSchema,
  ClearFailedJobsSchema,
  ClearQueueSchema,
  ResetWorkerSchema,
  CancelJobSchema,
  DismissFailedJobSchema,
  GetJobSchema,
  EnqueueJobSchema,
  SchemasSchema,
  PauseWorkerSchema,
  ResumeWorkerSchema,
  PauseAllSchema,
  ResumeAllSchema,
  GetWorkerStatusSchema,
  ListWorkersSchema,
  GetWorkerDefaultsSchema,
  UpdateWorkerDefaultsSchema,
  StatsSchema,
  PipelineHealthSchema,
  RetryFailedJobsSchema,
  ModelArtifactsSchema,
  ReprocessModelArtifactsSchema,
]);

type WorkerProgressRequest = z.infer<typeof RequestSchema>;

export function getFailedJobsQuery(workerType: string) {
  return {
    type: workerType,
    state: "failed",
  } as const;
}

export function getFailedJobRetryData(
  failedJob: {
    data?: Record<string, any>;
    progress?: Record<string, any>;
  },
  workerType: string,
) {
  const data: Record<string, any> & { type: string } = {
    ...(failedJob.data ?? {}),
    type: workerType,
  };

  // Automatic pipeline jobs normally contain only the worker type. Preserve
  // the source claimed by the failed run so a bulk retry targets each failed
  // source exactly once instead of creating many competing discovery jobs.
  if (
    workerType === "conversation_extractor" && !data.chunkId &&
    failedJob.progress?.chunkId
  ) {
    data.chunkId = failedJob.progress.chunkId;
  }
  if (
    workerType === "transcription" && !data.sequenceId &&
    failedJob.progress?.sequenceId
  ) {
    data.sequenceId = failedJob.progress.sequenceId;
  }

  return data;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
        .join(",")
    }}`;
  }
  return JSON.stringify(value);
}

export function groupFailedJobsForRetry(
  failedJobs: Array<{
    _id: { toString(): string };
    data?: Record<string, any>;
    progress?: Record<string, any>;
  }>,
  workerType: string,
) {
  const groups = new Map<
    string,
    {
      data: Record<string, any> & { type: string };
      failedJobs: typeof failedJobs;
    }
  >();

  for (const failedJob of failedJobs) {
    const data = getFailedJobRetryData(failedJob, workerType);
    const key = stableStringify(data);
    const group = groups.get(key);
    if (group) group.failedJobs.push(failedJob);
    else groups.set(key, { data, failedJobs: [failedJob] });
  }

  return [...groups.values()];
}

async function findSupersededFailedJobIds(
  mongo: ReturnType<typeof getMongoResource>,
  failedJobs: Array<{
    _id: { toString(): string };
    data?: Record<string, any>;
    progress?: Record<string, any>;
  }>,
  workerType: string,
): Promise<Set<string>> {
  const sourceToFailedJobs = new Map<string, string[]>();
  const addSource = (sourceId: unknown, failedJobId: string) => {
    if (typeof sourceId !== "string" || !ObjectId.isValid(sourceId)) return;
    const ids = sourceToFailedJobs.get(sourceId) ?? [];
    ids.push(failedJobId);
    sourceToFailedJobs.set(sourceId, ids);
  };

  for (const failedJob of failedJobs) {
    const failedJobId = failedJob._id.toString();
    if (workerType === "conversation_extractor") {
      addSource(
        failedJob.data?.chunkId ?? failedJob.progress?.chunkId,
        failedJobId,
      );
    } else if (workerType === "transcription") {
      addSource(
        failedJob.data?.sequenceId ?? failedJob.progress?.sequenceId,
        failedJobId,
      );
    } else if (workerType === "summarization") {
      addSource(failedJob.data?.objectId, failedJobId);
    }
  }

  if (sourceToFailedJobs.size === 0) return new Set();

  const sourceIds = [...sourceToFailedJobs.keys()].map((id) =>
    new ObjectId(id)
  );
  let completedSources: any[] = [];
  if (workerType === "conversation_extractor") {
    completedSources = await mongo({
      action: "find",
      collection: "conversation_chunks",
      query: {
        _id: { $in: sourceIds },
        state: { $in: ["completed", "empty"] },
      },
      options: { projection: { _id: 1 } },
    });
  } else if (workerType === "transcription") {
    completedSources = await mongo({
      action: "find",
      collection: "transcription_sequences",
      query: { _id: { $in: sourceIds }, state: "completed" },
      options: { projection: { _id: 1 } },
    });
  } else if (workerType === "summarization") {
    completedSources = await mongo({
      action: "find",
      collection: "objects",
      query: {
        _id: { $in: sourceIds },
        "summaries.0": { $exists: true },
      },
      options: { projection: { _id: 1 } },
    });
  }

  const superseded = new Set<string>();
  for (const source of completedSources) {
    for (
      const failedJobId of sourceToFailedJobs.get(source._id.toString()) ??
        []
    ) {
      superseded.add(failedJobId);
    }
  }
  return superseded;
}

export class JobsResource implements Resource<WorkerProgressRequest, any> {
  code = "jobs";
  description = "Update job progress, list jobs, or enqueue a new job";

  schemas = {
    request: RequestSchema,
    response: z.any(),
  };

  async use(input: WorkerProgressRequest, auth: Auth): Promise<any> {
    switch (input.action) {
      case "get":
        return this.get(input, auth);
      case "enqueue":
        return this.enqueue(input, auth);
      case "cancel":
        return this.cancel(input, auth);
      case "dismiss_failed":
        return this.dismissFailed(input, auth);
      case "cancel_all":
        return this.cancelAll(input, auth);
      case "clear_completed":
        return this.clearCompleted(input, auth);
      case "clear_failed":
        return this.clearFailed(input, auth);
      case "clear_queue":
        return this.clearQueue(input, auth);
      case "reset_worker":
        return this.resetWorker(input, auth);
      case "list":
        return this.list(input, auth);
      case "progressUpdate":
        return this.progressUpdate(input, auth);
      case "schemas":
        return this.schemasAction();
      case "pause_worker":
        return this.pauseWorker(input, auth);
      case "resume_worker":
        return this.resumeWorker(input, auth);
      case "pause_all":
        return this.pauseAll(auth);
      case "resume_all":
        return this.resumeAll(auth);
      case "get_worker_status":
        return this.getWorkerStatus(auth);
      case "list_workers":
        return this.listWorkers(auth);
      case "get_worker_defaults":
        return this.getWorkerDefaults(input, auth);
      case "update_worker_defaults":
        return this.updateWorkerDefaults(input, auth);
      case "stats":
        return this.stats(auth);
      case "pipeline_health":
        return this.pipelineHealth(input, auth);
      case "retry_failed":
        return this.retryFailed(input, auth);
      case "model_artifacts":
        return this.modelArtifacts(input, auth);
      case "reprocess_model_artifacts":
        return this.reprocessModelArtifacts(input, auth);
      default:
        throw new Error(`Unknown action: ${(input as any).action}`);
    }
  }

  private schemasAction() {
    return jobRegistry.getJobSchemas();
  }

  private async get(input: z.infer<typeof GetJobSchema>, auth: Auth) {
    const mongo = await getMongoResource(auth);

    const jobs = await mongo({
      action: "find",
      collection: "jobs",
      query: { _id: new ObjectId(input.id) },
      options: { limit: 1 },
    });

    const job = jobs[0];
    if (!job) {
      throw new Error(`Job ${input.id} not found`);
    }

    const queueJob = await getQueue(job.type).getJob(input.id);
    let queueState: string | null = null;
    if (queueJob) {
      try {
        queueState = await queueJob.getState();
      } catch {
        queueState = "unknown";
      }
    }

    let modelProvenance: JobModelProvenanceEntry[] | undefined;
    if (job.type === "conversation_extractor") {
      const entries: JobModelProvenanceEntry[] = [];
      const conversations = await mongo({
        action: "find",
        collection: "objects",
        query: { "metadata.extractedWith.jobId": input.id },
        options: {
          limit: 100,
          projection: {
            "metadata.extractedWith": 1,
          },
        },
      });

      for (const conversation of conversations) {
        const extractedWith = conversation.metadata?.extractedWith;
        if (extractedWith?.operations) {
          addModelProvenanceEntry(
            entries,
            extractedWith.operations.segmentation,
            "Segmentation",
          );
          addModelProvenanceEntry(
            entries,
            extractedWith.operations.metadata,
            "Metadata extraction",
          );
        } else {
          addModelProvenanceEntry(
            entries,
            extractedWith,
            "Conversation extraction",
          );
        }
      }

      // Empty or failed jobs may not have created a conversation object. Use
      // chunk provenance only when it belongs to this exact job; otherwise show
      // the requested alias without pretending that an executed model was saved.
      if (entries.length === 0) {
        const failedChunkId = typeof job.failedReason === "string"
          ? job.failedReason.match(/chunk\s+([a-f\d]{24})/i)?.[1]
          : undefined;
        const chunkId = job.data?.chunkId || job.progress?.chunkId ||
          failedChunkId;
        const chunks = await mongo({
          action: "find",
          collection: "conversation_chunks",
          query: chunkId
            ? { _id: new ObjectId(chunkId) }
            : { processedByJobId: input.id },
          options: {
            limit: 100,
            projection: {
              params: 1,
              inferenceProvenance: 1,
            },
          },
        });

        for (const chunk of chunks) {
          const segmentation = chunk.inferenceProvenance?.segmentation;
          if (segmentation?.jobId === input.id) {
            addModelProvenanceEntry(entries, segmentation, "Segmentation");
            for (const metadata of chunk.inferenceProvenance?.metadata ?? []) {
              addModelProvenanceEntry(
                entries,
                metadata,
                "Metadata extraction",
              );
            }
          }
        }

        if (entries.length === 0) {
          const requestedModel = job.data?.model || chunks[0]?.params?.model;
          if (requestedModel) {
            entries.push({
              stage: "Conversation extraction",
              requestedModel,
              fallbackModel: job.data?.fallbackModel,
              fallbackUsed: false,
              provenanceQuality: "requested_only",
            });
          }
        }
      }

      modelProvenance = entries;
    }

    return {
      id: job._id.toString(),
      type: job.type,
      data: job.data,
      state: job.state,
      progress: job.progress,
      result: job.result,
      trigger: job.trigger,
      timestamp: job.createdAt.getTime(),
      finishedOn: job.finishedAt?.getTime(),
      processedOn: job.startedAt?.getTime(),
      failedReason: job.failedReason,
      restarted: job.restartInfo != null,
      updatedOn: job.updatedAt?.getTime(),
      queueState,
      queuePresent: queueJob != null,
      ...(modelProvenance && { modelProvenance }),
    };
  }

  private async enqueue(input: z.infer<typeof EnqueueJobSchema>, auth: Auth) {
    // Access already checked by ResourceManager - escalate to server auth
    const serverAuth = await getServerAuth();
    const options: EnqueueJobOptions = {
      priority: input.priority,
      trigger: input.trigger,
    };
    const job = await enqueueJob(input.data, options, serverAuth);

    return {
      success: true,
      jobId: job.id,
    };
  }

  private async cancel(input: z.infer<typeof CancelJobSchema>, auth: Auth) {
    const mongo = await getMongoResource(auth);
    const { id } = input;

    const jobDocs = await mongo({
      action: "find",
      collection: "jobs",
      query: { _id: new ObjectId(id) },
      options: { limit: 1 },
    });

    const jobDoc = jobDocs[0];
    if (!jobDoc) {
      throw new Error(`Job ${id} not found`);
    }

    const jobType = jobDoc.type as string;
    const wasActive = jobDoc.state === "active";
    const queue = getQueue(jobType);
    const job = await queue.getJob(id);

    if (job) {
      try {
        await job.remove();
      } catch (err) {
        console.log(
          `[jobs] Could not remove BullMQ job ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const cancelResult = await mongo({
      action: "updateOne",
      collection: "jobs",
      query: {
        _id: new ObjectId(id),
        state: { $in: ["waiting", "active", "delayed"] },
      },
      update: {
        $set: {
          state: "cancelled",
          cancelReason: "user_cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });

    if ((cancelResult.modifiedCount ?? 0) === 0) {
      console.warn(
        `[jobs] Job ${id} reached a terminal state before cancellation could be recorded`,
      );
      return { success: true, cancelled: false };
    }

    const processTerminated = wasActive ? cancelRunningJob(id) : false;

    if (jobType === "summarization") {
      await mongo({
        action: "updateMany",
        collection: "objects",
        query: { "_summarizationClaim.jobId": id },
        update: { $unset: { _summarizationClaim: "" } },
      });
    }

    await publishJobUpdate(id, jobType, "job.state", {
      state: "cancelled",
      finishedOn: Date.now(),
    });

    return { success: true, cancelled: true, processTerminated };
  }

  private async dismissFailed(
    input: z.infer<typeof DismissFailedJobSchema>,
    auth: Auth,
  ) {
    const mongo = await getMongoResource(auth);
    const dismissedAt = new Date();
    const result = await mongo({
      action: "updateOne",
      collection: "jobs",
      query: {
        _id: new ObjectId(input.id),
        state: "failed",
        dismissedAt: { $exists: false },
      },
      update: {
        $set: {
          dismissedAt,
          dismissedReason: input.reason ?? "user_dismissed",
          updatedAt: dismissedAt,
        },
      },
    });

    if ((result.modifiedCount ?? 0) === 0) {
      throw new Error("Failed job was not found or was already dismissed");
    }

    return { success: true, id: input.id, dismissedAt };
  }

  private async cancelAll(
    _input: z.infer<typeof CancelAllJobsSchema>,
    auth: Auth,
  ) {
    const mongo = await getMongoResource(auth);

    // Never force-remove active BullMQ jobs: their processors keep running
    // without a lock and later surface as stalled, even after committing side
    // effects. Drain only jobs that have not started; active work completes.
    const types = jobRegistry.getJobTypes();
    for (const type of types) {
      const queue = getQueue(type);
      await queue.drain(true);
    }

    const result = await mongo({
      action: "updateMany",
      collection: "jobs",
      query: { state: { $in: ["waiting", "delayed"] } },
      update: {
        $set: {
          state: "cancelled",
          cancelReason: "all_queues_cleared",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });

    return {
      success: true,
      cancelledCount: result.modifiedCount ?? 0,
      activeJobsContinued: true,
    };
  }

  private async clearCompleted(
    _input: z.infer<typeof ClearCompletedJobsSchema>,
    auth: Auth,
  ) {
    const mongo = await getMongoResource(auth);

    // Delete all completed, failed, and cancelled jobs from MongoDB
    const result = await mongo({
      action: "deleteMany",
      collection: "jobs",
      query: { state: { $in: ["completed", "failed", "cancelled"] } },
    });

    return {
      success: true,
      deletedCount: result.deletedCount || 0,
    };
  }

  private async clearFailed(
    input: z.infer<typeof ClearFailedJobsSchema>,
    auth: Auth,
  ) {
    const types = jobRegistry.getJobTypes();
    if (!types.includes(input.workerType)) {
      throw new Error(`Unknown worker type: ${input.workerType}`);
    }

    const mongo = await getMongoResource(auth);
    const result = await mongo({
      action: "deleteMany",
      collection: "jobs",
      query: getFailedJobsQuery(input.workerType),
    });

    return {
      success: true,
      workerType: input.workerType,
      deletedCount: result.deletedCount || 0,
    };
  }

  private async clearQueue(
    input: z.infer<typeof ClearQueueSchema>,
    auth: Auth,
  ) {
    const types = jobRegistry.getJobTypes();
    if (!types.includes(input.workerType)) {
      throw new Error(`Unknown worker type: ${input.workerType}`);
    }

    // Drain only work that has not started. Removing an active BullMQ job with
    // obliterate(force) invalidates its lock while its processor is still
    // running, which can produce duplicate side effects and requires a worker
    // restart. Active jobs therefore finish normally.
    const queue = getQueue(input.workerType);
    await queue.drain(true);

    const now = new Date();
    const mongo = await getMongoResource(auth);
    const result = await mongo({
      action: "updateMany",
      collection: "jobs",
      query: {
        type: input.workerType,
        state: { $in: ["waiting", "delayed"] },
      },
      update: {
        $set: {
          state: "cancelled",
          cancelReason: "queue_cleared",
          finishedAt: now,
          updatedAt: now,
        },
      },
    });

    return {
      success: true,
      workerType: input.workerType,
      cancelledCount: result.modifiedCount || 0,
    };
  }

  private async retryFailed(
    input: z.infer<typeof RetryFailedJobsSchema>,
    auth: Auth,
  ) {
    const types = jobRegistry.getJobTypes();
    if (!types.includes(input.workerType)) {
      throw new Error(`Unknown worker type: ${input.workerType}`);
    }

    // A manual retry must not create another batch of known provider errors.
    await assertJobServicesHealthy(input.workerType, true);

    const mongo = await getMongoResource(auth);
    const failedJobs = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        type: input.workerType,
        state: "failed",
        retriedAt: { $exists: false },
        dismissedAt: { $exists: false },
      },
      options: { sort: { createdAt: 1 }, limit: input.limit },
    }) as any[];

    const supersededIds = await findSupersededFailedJobIds(
      mongo,
      failedJobs,
      input.workerType,
    );
    const retryCandidates = failedJobs.filter((job) =>
      !supersededIds.has(job._id.toString())
    );
    if (supersededIds.size > 0) {
      const dismissedAt = new Date();
      await mongo({
        action: "updateMany",
        collection: "jobs",
        query: {
          _id: {
            $in: [...supersededIds].map((id) => new ObjectId(id)),
          },
          dismissedAt: { $exists: false },
        },
        update: {
          $set: {
            dismissedAt,
            dismissedReason: "source_already_completed",
            updatedAt: dismissedAt,
          },
        },
      });
    }

    const serverAuth = await getServerAuth();
    const retried: Array<{ failedJobId: string; retryJobId: string }> = [];
    const errors: string[] = [];

    for (
      const group of groupFailedJobsForRetry(
        retryCandidates,
        input.workerType,
      )
    ) {
      const firstFailedJob = group.failedJobs[0];
      try {
        const retryJob = await enqueueJob(group.data, {
          trigger: {
            type: "manual",
            reason: `retry_failed:${firstFailedJob._id.toString()}`,
          },
        }, serverAuth);
        const retriedAt = new Date();
        await mongo({
          action: "updateMany",
          collection: "jobs",
          query: {
            _id: { $in: group.failedJobs.map((job) => job._id) },
            retriedAt: { $exists: false },
          },
          update: {
            $set: {
              retriedAt,
              retryJobId: retryJob.id,
              updatedAt: retriedAt,
            },
          },
        });
        retried.push(...group.failedJobs.map((failedJob) => ({
          failedJobId: failedJob._id.toString(),
          retryJobId: retryJob.id!,
        })));
      } catch (error) {
        errors.push(
          `${firstFailedJob._id.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        break;
      }
    }

    return {
      success: errors.length === 0,
      workerType: input.workerType,
      retriedCount: retried.length,
      dismissedCount: supersededIds.size,
      handledCount: retried.length + supersededIds.size,
      queuedCount: new Set(retried.map((item) => item.retryJobId)).size,
      retried,
      errors,
    };
  }

  private async modelArtifacts(
    input: z.infer<typeof ModelArtifactsSchema>,
    auth: Auth,
  ) {
    const mongo = await getMongoResource(auth);
    const requestedTypes = new Set(
      input.artifactTypes?.length
        ? input.artifactTypes
        : ModelArtifactTypeSchema.options,
    );
    const modelMatch = input.model && input.model !== "all"
      ? { executedModel: input.model }
      : null;
    const generatedAtMatch: Record<string, Date> = {};
    if (input.from) generatedAtMatch.$gte = new Date(`${input.from}T00:00:00`);
    if (input.to) generatedAtMatch.$lte = new Date(`${input.to}T23:59:59.999`);

    const facetFor = (
      base: Record<string, unknown>[],
      project: Record<string, unknown>,
    ) => [
      ...base,
      { $project: project },
      ...(modelMatch ? [{ $match: modelMatch }] : []),
      ...(Object.keys(generatedAtMatch).length
        ? [{ $match: { generatedAt: generatedAtMatch } }]
        : []),
      {
        $facet: {
          entries: [
            { $sort: { generatedAt: -1 } },
            { $limit: input.limit },
          ],
          models: [
            { $match: { executedModel: { $type: "string", $ne: "" } } },
            {
              $group: {
                _id: "$executedModel",
                count: { $sum: 1 },
                latestAt: { $max: "$generatedAt" },
              },
            },
          ],
          total: [{ $count: "value" }],
        },
      },
    ];

    const queries: Array<Promise<any>> = [];

    if (requestedTypes.has("summary")) {
      queries.push(mongo({
        action: "aggregate",
        collection: "objects",
        pipeline: facetFor(
          [
            { $match: { "summaries.0": { $exists: true } } },
            {
              $unwind: {
                path: "$summaries",
                includeArrayIndex: "artifactIndex",
              },
            },
          ],
          {
            _id: 0,
            id: {
              $concat: [
                { $toString: "$_id" },
                ":summary:",
                { $toString: "$artifactIndex" },
              ],
            },
            artifactType: { $literal: "summary" },
            objectId: { $toString: "$_id" },
            objectName: { $ifNull: ["$name", "Untitled conversation"] },
            generatedAt: "$summaries.date",
            requestedModel: {
              $ifNull: ["$summaries.requestedModel", "$summaries.model"],
            },
            executedModel: {
              $ifNull: [
                "$summaries.resolvedModel",
                { $ifNull: ["$summaries.modelName", "$summaries.model"] },
              ],
            },
            fallbackModel: "$summaries.fallbackModel",
            fallbackUsed: { $ifNull: ["$summaries.fallbackUsed", false] },
            providerBaseUrl: {
              $ifNull: [
                "$summaries.provenance.providerBaseUrl",
                "$summaries.providerBaseUrl",
              ],
            },
            providerProfileId: "$summaries.provenance.providerProfileId",
            providerProfileName: "$summaries.provenance.providerProfileName",
            jobId: "$summaries.jobId",
            provenanceQuality: {
              $cond: [
                {
                  $ne: [{ $ifNull: ["$summaries.resolvedModel", null] }, null],
                },
                "exact",
                "legacy_response_model",
              ],
            },
          },
        ),
      }));
    }

    if (requestedTypes.has("conversation_extraction")) {
      queries.push(mongo({
        action: "aggregate",
        collection: "objects",
        pipeline: facetFor(
          [{
            $match: {
              isConversation: true,
              "metadata.extractedWith": { $exists: true },
            },
          }],
          {
            _id: 0,
            id: {
              $concat: [{ $toString: "$_id" }, ":conversation_extraction"],
            },
            artifactType: { $literal: "conversation_extraction" },
            objectId: { $toString: "$_id" },
            objectName: { $ifNull: ["$name", "Untitled conversation"] },
            generatedAt: {
              $convert: {
                input: "$metadata.extractedWith.timestamp",
                to: "date",
                onError: null,
                onNull: null,
              },
            },
            requestedModel: {
              $ifNull: [
                "$metadata.extractedWith.requestedModel",
                "$metadata.extractedWith.model",
              ],
            },
            executedModel: {
              $ifNull: [
                "$metadata.extractedWith.resolvedModel",
                "$metadata.extractedWith.model",
              ],
            },
            fallbackModel: "$metadata.extractedWith.fallbackModel",
            fallbackUsed: {
              $ifNull: ["$metadata.extractedWith.fallbackUsed", false],
            },
            providerBaseUrl: "$metadata.extractedWith.providerBaseUrl",
            providerProfileId: "$metadata.extractedWith.providerProfileId",
            providerProfileName: "$metadata.extractedWith.providerProfileName",
            jobId: "$metadata.extractedWith.jobId",
            chunkId: "$metadata.extractedWith.chunkId",
            provenanceQuality: {
              $cond: [
                {
                  $ne: [
                    {
                      $ifNull: ["$metadata.extractedWith.resolvedModel", null],
                    },
                    null,
                  ],
                },
                "exact",
                "legacy_requested_only",
              ],
            },
          },
        ),
      }));
    }

    if (requestedTypes.has("tagging")) {
      queries.push(mongo({
        action: "aggregate",
        collection: "objects",
        pipeline: facetFor(
          [
            {
              $match: {
                isConversation: true,
                "metadata.aiProvenance.taggingRuns.0": { $exists: true },
              },
            },
            {
              $unwind: {
                path: "$metadata.aiProvenance.taggingRuns",
                includeArrayIndex: "artifactIndex",
              },
            },
          ],
          {
            _id: 0,
            id: {
              $concat: [
                { $toString: "$_id" },
                ":tagging:",
                { $toString: "$artifactIndex" },
              ],
            },
            artifactType: { $literal: "tagging" },
            objectId: { $toString: "$_id" },
            objectName: { $ifNull: ["$name", "Untitled conversation"] },
            generatedAt: "$metadata.aiProvenance.taggingRuns.generatedAt",
            requestedModel: "$metadata.aiProvenance.taggingRuns.requestedModel",
            executedModel: "$metadata.aiProvenance.taggingRuns.resolvedModel",
            fallbackModel: "$metadata.aiProvenance.taggingRuns.fallbackModel",
            fallbackUsed: {
              $ifNull: [
                "$metadata.aiProvenance.taggingRuns.fallbackUsed",
                false,
              ],
            },
            providerBaseUrl:
              "$metadata.aiProvenance.taggingRuns.providerBaseUrl",
            providerProfileId:
              "$metadata.aiProvenance.taggingRuns.providerProfileId",
            providerProfileName:
              "$metadata.aiProvenance.taggingRuns.providerProfileName",
            jobId: "$metadata.aiProvenance.taggingRuns.jobId",
            parseStatus: "$metadata.aiProvenance.taggingRuns.parseStatus",
            selectedTagCount:
              "$metadata.aiProvenance.taggingRuns.selectedTagCount",
            provenanceQuality: { $literal: "exact" },
          },
        ),
      }));
    }

    const [results, incompleteSummaries, legacyExtractions, legacyTags] =
      await Promise.all([
        Promise.all(queries),
        mongo({
          action: "count",
          collection: "objects",
          query: {
            summaries: {
              $elemMatch: {
                resolvedModel: { $exists: false },
              },
            },
          },
        }),
        mongo({
          action: "count",
          collection: "objects",
          query: {
            isConversation: true,
            "metadata.extractedWith.model": { $exists: true },
            "metadata.extractedWith.resolvedModel": { $exists: false },
          },
        }),
        mongo({
          action: "count",
          collection: "objects",
          query: {
            isRelationship: true,
            name: "tagged",
            "metadata.generatedWith": { $exists: false },
          },
        }),
      ]);

    const entries: any[] = [];
    const models = new Map<string, { count: number; latestAt?: Date }>();
    let total = 0;
    results.forEach((result: any) => {
      const facet = Array.isArray(result) ? result[0] : null;
      for (const entry of facet?.entries ?? []) entries.push(entry);
      total += facet?.total?.[0]?.value ?? 0;
      for (const item of facet?.models ?? []) {
        const current = models.get(item._id) ?? { count: 0 };
        current.count += item.count ?? 0;
        if (!current.latestAt || item.latestAt > current.latestAt) {
          current.latestAt = item.latestAt;
        }
        models.set(item._id, current);
      }
    });

    entries.sort((left, right) =>
      new Date(right.generatedAt ?? 0).getTime() -
      new Date(left.generatedAt ?? 0).getTime()
    );

    return {
      entries: entries.slice(0, input.limit),
      total,
      models: [...models.entries()]
        .map(([model, value]) => ({ model, ...value }))
        .sort((left, right) =>
          new Date(right.latestAt ?? 0).getTime() -
          new Date(left.latestAt ?? 0).getTime()
        ),
      gaps: {
        legacySummariesWithoutExactRouting: incompleteSummaries,
        legacyExtractionsWithRequestedAliasOnly: legacyExtractions,
        legacyTagRelationshipsWithoutProvenance: legacyTags,
      },
    };
  }

  private async reprocessModelArtifacts(
    input: z.infer<typeof ReprocessModelArtifactsSchema>,
    auth: Auth,
  ) {
    if (input.sourceModel === input.targetModel) {
      throw new Error("Choose a target model different from the source model");
    }
    await assertJobServicesHealthy("summarization", true);

    const mongo = await getMongoResource(auth);
    const selectedObjectIds = (input.artifactIds ?? [])
      .map((id) => id.split(":", 1)[0])
      .filter((id) => ObjectId.isValid(id));
    const objects = await mongo({
      action: "aggregate",
      collection: "objects",
      pipeline: [
        {
          $match: {
            isConversation: true,
            ...(selectedObjectIds.length
              ? {
                _id: { $in: selectedObjectIds.map((id) => new ObjectId(id)) },
              }
              : {}),
            $expr: {
              $anyElementTrue: {
                $map: {
                  input: { $ifNull: ["$summaries", []] },
                  as: "summary",
                  in: {
                    $eq: [
                      {
                        $ifNull: [
                          "$$summary.resolvedModel",
                          {
                            $ifNull: [
                              "$$summary.modelName",
                              "$$summary.model",
                            ],
                          },
                        ],
                      },
                      input.sourceModel,
                    ],
                  },
                },
              },
            },
          },
        },
        {
          $match: {
            $expr: {
              $not: [{
                $anyElementTrue: {
                  $map: {
                    input: { $ifNull: ["$summaries", []] },
                    as: "summary",
                    in: {
                      $eq: [
                        {
                          $ifNull: [
                            "$$summary.resolvedModel",
                            {
                              $ifNull: [
                                "$$summary.modelName",
                                "$$summary.model",
                              ],
                            },
                          ],
                        },
                        input.targetModel,
                      ],
                    },
                  },
                },
              }],
            },
          },
        },
        { $limit: input.limit },
        { $project: { _id: 1 } },
      ],
    }) as Array<{ _id: ObjectId }>;

    const objectIds = objects.map((object) => object._id.toString());
    const unfinishedJobs = objectIds.length
      ? await mongo({
        action: "find",
        collection: "jobs",
        query: {
          type: "summarization",
          state: { $in: ["waiting", "active", "delayed", "paused"] },
          "data.objectId": { $in: objectIds },
          "data.model": input.targetModel,
        },
        options: { projection: { "data.objectId": 1 } },
      }) as any[]
      : [];
    const alreadyQueued = new Set(
      unfinishedJobs.map((job) => job.data?.objectId?.toString()),
    );

    const serverAuth = await getServerAuth();
    const queued: Array<{ objectId: string; jobId: string }> = [];
    for (const objectId of objectIds) {
      if (alreadyQueued.has(objectId)) continue;
      const job = await enqueueJob({
        type: "summarization",
        objectId,
        model: input.targetModel,
        allowExisting: true,
      }, {
        trigger: {
          type: "manual",
          reason: `model_quality_rerun:${input.sourceModel}`,
        },
      }, serverAuth);
      queued.push({ objectId, jobId: job.id! });
    }

    return {
      success: true,
      artifactType: input.artifactType,
      sourceModel: input.sourceModel,
      targetModel: input.targetModel,
      matched: objectIds.length,
      queued,
      skippedAlreadyQueued: objectIds.length - queued.length,
      mode: "append_summary_version",
    };
  }

  private async pipelineHealth(
    input: z.infer<typeof PipelineHealthSchema>,
    auth: Auth,
  ) {
    const mongo = await getMongoResource(auth);

    const [
      services,
      transcriptionReady,
      transcriptionRetryable,
      transcriptionProcessing,
      extractionReady,
      extractionRetryable,
      extractionProcessing,
      summariesMissing,
      failedByWorker,
      activeTranscriptionJobs,
      recentTranscriptionBatches,
    ] = await Promise.all([
      getExternalServicesHealth(input.force ?? false),
      mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "ready" },
      }),
      mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "error" },
      }),
      mongo({
        action: "count",
        collection: "transcription_sequences",
        query: { state: "processing" },
      }),
      mongo({
        action: "count",
        collection: "conversation_chunks",
        query: { state: "ready" },
      }),
      mongo({
        action: "count",
        collection: "conversation_chunks",
        query: { state: "error" },
      }),
      mongo({
        action: "count",
        collection: "conversation_chunks",
        query: { state: "processing" },
      }),
      mongo({
        action: "count",
        collection: "objects",
        query: {
          isConversation: true,
          "summaries.0": { $exists: false },
        },
      }),
      mongo({
        action: "aggregate",
        collection: "jobs",
        pipeline: [
          {
            $match: {
              state: "failed",
              retriedAt: { $exists: false },
              dismissedAt: { $exists: false },
              type: {
                $in: [
                  "transcription",
                  "conversation_extractor",
                  "summarization",
                ],
              },
            },
          },
          { $group: { _id: "$type", count: { $sum: 1 } } },
        ],
      }),
      mongo({
        action: "find",
        collection: "jobs",
        query: { type: "transcription", state: "active" },
        options: {
          sort: { updatedAt: -1 },
          limit: 1,
          projection: { _id: 1, progress: 1, updatedAt: 1, processedOn: 1 },
        },
      }),
      mongo({
        action: "find",
        collection: "jobs",
        query: {
          type: "transcription",
          state: "completed",
          "result.batchSize": { $exists: true },
        },
        options: {
          sort: { finishedAt: -1 },
          limit: 5,
          projection: { _id: 1, result: 1, finishedAt: 1 },
        },
      }),
    ]);

    const failedCounts = Object.fromEntries(
      (failedByWorker as any[]).map((entry) => [entry._id, entry.count]),
    );

    return {
      checkedAt: new Date().toISOString(),
      services,
      backlogs: {
        transcription: {
          ready: Number(transcriptionReady),
          retryableErrors: Number(transcriptionRetryable),
          processing: Number(transcriptionProcessing),
          failedJobsUnretried: Number(failedCounts.transcription ?? 0),
        },
        conversation_extractor: {
          ready: Number(extractionReady),
          retryableErrors: Number(extractionRetryable),
          processing: Number(extractionProcessing),
          failedJobsUnretried: Number(
            failedCounts.conversation_extractor ?? 0,
          ),
        },
        summarization: {
          // Conversation extraction already derives these objects from
          // transcript-backed chunks. Avoid a dashboard-wide range join here:
          // on a large library it can take minutes and block every health card.
          ready: Number(summariesMissing),
          missingTotal: Number(summariesMissing),
          failedJobsUnretried: Number(failedCounts.summarization ?? 0),
        },
      },
      recovery: {
        startupChecks: true,
        periodicRetrySeconds: 300,
        note:
          "Failed job history is retained. Retryable source records are checked on startup and every 5 minutes after dependencies recover.",
      },
      transcriptionRuntime: {
        configuredBatchSize: env.TRANSCRIPTION_BATCH_SIZE,
        activeBatch: (activeTranscriptionJobs as any[]).map((job) => ({
          jobId: job._id?.toString(),
          updatedAt: job.updatedAt,
          processedOn: job.processedOn,
          progress: job.progress || {},
        }))[0] ?? null,
        recentBatches: (recentTranscriptionBatches as any[]).map((job) => ({
          jobId: job._id?.toString(),
          finishedAt: job.finishedAt,
          batchSize: job.result?.batchSize,
          processed: job.result?.processed,
          sequences: job.result?.batchSequences || [],
        })),
      },
    };
  }

  private async resetWorker(
    input: z.infer<typeof ResetWorkerSchema>,
    auth: Auth,
  ) {
    const { workerType, restart } = input;
    const types = jobRegistry.getJobTypes();
    if (!types.includes(workerType)) {
      throw new Error(`Unknown worker type: ${workerType}`);
    }

    // Pause first so draining the queue cannot race with a worker taking the
    // next waiting job.
    await workerPauseManager.pauseWorker(workerType);
    await this.persistWorkerConfig(workerType, { paused: true }, auth);

    const mongo = await getMongoResource(auth);
    const liveJobs = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        type: workerType,
        state: { $in: ["active", "waiting", "delayed"] },
      },
      options: { limit: 5000 },
    });

    const queue = getQueue(workerType);
    await queue.drain(true);

    let terminatedCount = 0;
    for (const job of liveJobs) {
      if (job.state === "active" && cancelRunningJob(job._id.toString())) {
        terminatedCount++;
      }
    }

    const now = new Date();
    const cancelled = await mongo({
      action: "updateMany",
      collection: "jobs",
      query: {
        type: workerType,
        state: { $in: ["active", "waiting", "delayed"] },
      },
      update: {
        $set: {
          state: "cancelled",
          cancelReason: "worker_reset",
          finishedAt: now,
          updatedAt: now,
        },
      },
    });

    let claimsCleared = 0;
    if (workerType === "summarization") {
      const claimResult = await mongo({
        action: "updateMany",
        collection: "objects",
        query: { "_summarizationClaim.jobId": { $exists: true } },
        update: { $unset: { _summarizationClaim: "" } },
      });
      claimsCleared = claimResult.modifiedCount ?? 0;
    }

    let restartedJobId: string | undefined;
    if (restart) {
      const newJob = await enqueueJob(
        { type: workerType },
        { trigger: { type: "manual", reason: "worker_reset" } },
        await getServerAuth(),
      );
      restartedJobId = newJob.id;
      await workerPauseManager.resumeWorker(workerType);
      await this.persistWorkerConfig(workerType, { paused: false }, auth);
    }

    return {
      success: true,
      workerType,
      cancelledCount: cancelled.modifiedCount ?? 0,
      terminatedCount,
      claimsCleared,
      restartedJobId,
      paused: !restart,
    };
  }

  private async list(input: z.infer<typeof ListJobsSchema>, auth: Auth) {
    const mongo = await getMongoResource(auth);

    const types = input.types || jobRegistry.getJobTypes();
    const queryStatuses = input.statuses ||
      ["active", "waiting", "delayed", "failed", "completed"];

    const totalLimit = input.limit || 100;

    const jobs = await mongo({
      action: "find",
      collection: "jobs",
      query: {
        type: { $in: types },
        state: { $in: queryStatuses },
        dismissedAt: { $exists: false },
      },
      options: {
        sort: { createdAt: -1 },
        limit: totalLimit,
      },
    });

    return jobs.map((job: any) => ({
      id: job._id.toString(),
      type: job.type,
      data: job.data,
      state: job.state,
      progress: job.progress,
      result: job.result,
      trigger: job.trigger,
      timestamp: job.createdAt.getTime(),
      finishedOn: job.finishedAt?.getTime(),
      processedOn: job.startedAt?.getTime(),
      failedReason: job.failedReason,
      restarted: job.restartInfo != null,
    }));
  }

  private async progressUpdate(
    input: z.infer<typeof UpdateProgressSchema>,
    auth: Auth,
  ) {
    const mongoRoot = await getMongoResource(await getServerAuth());
    const { jobId, progress } = input;

    const jobDocs = await mongoRoot({
      action: "find",
      collection: "jobs",
      query: { _id: new ObjectId(jobId) },
      options: { limit: 1 },
    });

    const jobDoc = jobDocs[0];
    if (!jobDoc) {
      console.log(
        `[jobs] Job ${jobId} not found in MongoDB, cannot update progress`,
      );
      return { success: false, error: "Job not found" };
    }

    const jobType = jobDoc.type as string;

    // Check if this progress update is "newer" than what we have
    const currentProgress = jobDoc.progress;
    if (
      currentProgress && typeof currentProgress === "object" &&
      typeof progress === "object"
    ) {
      const currentVal = currentProgress.progress ?? currentProgress.iteration;
      const newVal = progress.progress ?? progress.iteration;

      if (
        typeof currentVal === "number" && typeof newVal === "number" &&
        newVal < currentVal
      ) {
        console.log(
          `[jobs] Ignoring stale progress update for ${jobId} (${newVal} < ${currentVal})`,
        );
        return { success: true, status: "stale" };
      }
    }

    await mongoRoot({
      action: "updateOne",
      collection: "jobs",
      query: { _id: new ObjectId(jobId) },
      update: {
        $set: {
          progress,
          updatedAt: new Date(),
        },
      },
    });

    const queue = getQueue(jobType);
    const job = await queue.getJob(jobId);

    if (job) {
      try {
        await job.updateProgress(progress);
      } catch (err) {
        console.log(
          `[jobs] Could not update BullMQ progress for job ${jobId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    await publishJobUpdate(jobId, jobType, "job.progress", {
      state: "active",
      progress,
      processedOn: jobDoc.startedAt?.getTime(),
    });

    return { success: true };
  }

  private async pauseWorker(
    input: z.infer<typeof PauseWorkerSchema>,
    auth: Auth,
  ) {
    const { workerType } = input;

    // Verify worker type exists
    const types = jobRegistry.getJobTypes();
    if (!types.includes(workerType)) {
      throw new Error(`Unknown worker type: ${workerType}`);
    }

    await workerPauseManager.pauseWorker(workerType);
    await this.persistWorkerConfig(workerType, { paused: true }, auth);

    return { success: true, workerType, paused: true };
  }

  private async resumeWorker(
    input: z.infer<typeof ResumeWorkerSchema>,
    auth: Auth,
  ) {
    const { workerType } = input;

    // Verify worker type exists
    const types = jobRegistry.getJobTypes();
    if (!types.includes(workerType)) {
      throw new Error(`Unknown worker type: ${workerType}`);
    }

    await workerPauseManager.resumeWorker(workerType);
    await this.persistWorkerConfig(workerType, { paused: false }, auth);

    return { success: true, workerType, paused: false };
  }

  private async pauseAll(auth: Auth) {
    const types = jobRegistry.getJobTypes();

    for (const workerType of types) {
      await workerPauseManager.pauseWorker(workerType);
      await this.persistWorkerConfig(workerType, { paused: true }, auth);
    }

    return { success: true, pausedWorkers: types };
  }

  private async resumeAll(auth: Auth) {
    const types = jobRegistry.getJobTypes();

    for (const workerType of types) {
      await workerPauseManager.resumeWorker(workerType);
      await this.persistWorkerConfig(workerType, { paused: false }, auth);
    }

    return { success: true, resumedWorkers: types };
  }

  private async getWorkerStatus(_auth: Auth) {
    const types = jobRegistry.getJobTypes();
    const status: Record<string, { paused: boolean }> = {};

    for (const workerType of types) {
      status[workerType] = {
        paused: workerPauseManager.isPaused(workerType),
      };
    }

    return { workers: status };
  }

  private async stats(auth: Auth) {
    const mongo = await getMongoResource(auth);
    const staleCutoff = new Date(Date.now() - 15 * 60 * 1000);
    // TODO: worker specific logic should belong to the worker file

    // Get overall counts by status (across ALL jobs, not limited)
    const statusCountsPipeline = [
      { $match: { dismissedAt: { $exists: false } } },
      {
        $group: {
          _id: "$state",
          count: { $sum: 1 },
        },
      },
    ];

    const statusCounts = await mongo({
      action: "aggregate",
      collection: "jobs",
      pipeline: statusCountsPipeline,
    });

    // Convert to a map
    const byStatus: Record<string, number> = {
      active: 0,
      waiting: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      cancelled: 0,
    };
    let total = 0;
    for (const item of statusCounts) {
      if (item._id) {
        byStatus[item._id] = item.count;
        total += item.count;
      }
    }

    // Aggregate job statistics by type
    const pipeline = [
      { $match: { dismissedAt: { $exists: false } } },
      {
        $group: {
          _id: "$type",
          totalRuns: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$state", "active"] }, 1, 0] },
          },
          staleActive: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$state", "active"] },
                    { $lte: ["$startedAt", staleCutoff] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          waiting: {
            $sum: { $cond: [{ $eq: ["$state", "waiting"] }, 1, 0] },
          },
          delayed: {
            $sum: { $cond: [{ $eq: ["$state", "delayed"] }, 1, 0] },
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$state", "completed"] }, 1, 0] },
          },
          failed: {
            $sum: { $cond: [{ $eq: ["$state", "failed"] }, 1, 0] },
          },
          // Calculate empty jobs based on result fields
          emptyRuns: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$state", "completed"] },
                    {
                      $or: [
                        // VAD: hasSpeech=0 and processed=0
                        {
                          $and: [
                            { $eq: ["$type", "vad"] },
                            {
                              $eq: [{
                                $ifNull: ["$result.hasSpeech", {
                                  $ifNull: ["$progress.hasSpeech", -1],
                                }],
                              }, 0],
                            },
                            {
                              $eq: [{
                                $ifNull: ["$result.processed", {
                                  $ifNull: ["$progress.processed", -1],
                                }],
                              }, 0],
                            },
                          ],
                        },
                        // conversation_chunk_creator: finalized=0 and streamed=0 and chunksCreated=0
                        {
                          $and: [
                            { $eq: ["$type", "conversation_chunk_creator"] },
                            { $eq: [{ $ifNull: ["$result.finalized", 0] }, 0] },
                            { $eq: [{ $ifNull: ["$result.streamed", 0] }, 0] },
                            {
                              $eq: [
                                { $ifNull: ["$result.chunksCreated", 0] },
                                0,
                              ],
                            },
                          ],
                        },
                        // conversation_extractor: conversationsCreated=0 and chunksProcessed=0
                        {
                          $and: [
                            { $eq: ["$type", "conversation_extractor"] },
                            {
                              $eq: [{
                                $ifNull: ["$result.conversationsCreated", 0],
                              }, 0],
                            },
                            {
                              $eq: [
                                { $ifNull: ["$result.chunksProcessed", 0] },
                                0,
                              ],
                            },
                          ],
                        },
                        // transcription_sequence_creator: processed=0
                        {
                          $and: [
                            {
                              $eq: ["$type", "transcription_sequence_creator"],
                            },
                            { $eq: [{ $ifNull: ["$result.processed", 0] }, 0] },
                          ],
                        },
                        // transcription: processed=0
                        {
                          $and: [
                            { $eq: ["$type", "transcription"] },
                            {
                              $eq: [{
                                $ifNull: ["$result.processed", {
                                  $ifNull: ["$progress.processed", -1],
                                }],
                              }, 0],
                            },
                          ],
                        },
                        // Generic: processed=0 and total=0 for other types
                        {
                          $and: [
                            {
                              $not: {
                                $in: ["$type", [
                                  "vad",
                                  "conversation_chunk_creator",
                                  "conversation_extractor",
                                  "transcription_sequence_creator",
                                  "transcription",
                                  "summarization",
                                ]],
                              },
                            },
                            {
                              $eq: [{
                                $ifNull: ["$result.processed", {
                                  $ifNull: ["$progress.processed", -1],
                                }],
                              }, 0],
                            },
                            {
                              $eq: [{
                                $ifNull: ["$result.total", {
                                  $ifNull: ["$progress.total", -1],
                                }],
                              }, 0],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
          // Get timestamps for frequency calculation (last 20)
          recentTimestamps: {
            $push: {
              $cond: [
                { $eq: ["$state", "completed"] },
                { $toLong: "$createdAt" },
                null,
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          type: "$_id",
          totalRuns: 1,
          active: 1,
          waiting: 1,
          delayed: 1,
          completed: 1,
          failed: 1,
          emptyRuns: 1,
          successRate: {
            $cond: [
              { $eq: ["$totalRuns", 0] },
              0,
              { $multiply: [{ $divide: ["$completed", "$totalRuns"] }, 100] },
            ],
          },
          // Filter out nulls and get last 20 timestamps
          recentTimestamps: {
            $slice: [
              {
                $filter: {
                  input: "$recentTimestamps",
                  as: "ts",
                  cond: { $ne: ["$$ts", null] },
                },
              },
              -20,
            ],
          },
        },
      },
    ];

    const stats = await mongo({
      action: "aggregate",
      collection: "jobs",
      pipeline,
    });

    // Calculate frequency from timestamps
    const staleClaims = await mongo({
      action: "count",
      collection: "objects",
      query: {
        "_summarizationClaim.startedAt": {
          $lte: staleCutoff.toISOString(),
        },
      },
    }) as number;

    const result = stats.map((stat: any) => {
      const timestamps = stat.recentTimestamps || [];
      let avgFrequency = "-";

      if (timestamps.length >= 2) {
        const sorted = [...timestamps].sort((a: number, b: number) => b - a);
        let totalGap = 0;
        for (let i = 0; i < sorted.length - 1; i++) {
          totalGap += sorted[i] - sorted[i + 1];
        }
        const avgMs = totalGap / (sorted.length - 1);

        if (avgMs < 60000) avgFrequency = `~${Math.round(avgMs / 1000)}s`;
        else if (avgMs < 3600000) {
          avgFrequency = `~${Math.round(avgMs / 60000)}m`;
        } else avgFrequency = `~${(avgMs / 3600000).toFixed(1)}h`;
      }

      return {
        type: stat.type,
        totalRuns: stat.totalRuns ?? 0,
        active: stat.active ?? 0,
        staleActive: stat.staleActive ?? 0,
        staleClaims: stat.type === "summarization" ? staleClaims : 0,
        waiting: stat.waiting ?? 0,
        delayed: stat.delayed ?? 0,
        completed: stat.completed ?? 0,
        failed: stat.failed ?? 0,
        emptyRuns: stat.emptyRuns ?? 0,
        successRate: stat.successRate ?? 0,
        avgFrequency,
      };
    });

    return {
      stats: result,
      totals: {
        ...byStatus,
        total,
      },
    };
  }

  private async persistWorkerConfig(
    workerType: string,
    config: { paused: boolean },
    auth: Auth,
  ) {
    const configResource = await getConfigResource(auth);

    await configResource({
      action: "patch",
      path: `workers.${workerType}`,
      updates: config,
    });
  }

  private async listWorkers(_auth: Auth) {
    const { workerDiscovery } = await import("@/lib/jobs/worker-discovery.ts");
    const workers = await workerDiscovery.getAllWorkers();

    return { workers };
  }

  private async getWorkerDefaults(
    input: z.infer<typeof GetWorkerDefaultsSchema>,
    _auth: Auth,
  ) {
    const { workerDiscovery } = await import("@/lib/jobs/worker-discovery.ts");
    const defaults = await workerDiscovery.getDefaultOverrides(
      input.workerType,
    );

    return {
      workerType: input.workerType,
      defaults: defaults || {},
    };
  }

  private async updateWorkerDefaults(
    input: z.infer<typeof UpdateWorkerDefaultsSchema>,
    _auth: Auth,
  ) {
    const { workerDiscovery } = await import("@/lib/jobs/worker-discovery.ts");

    // Verify worker type exists
    const types = jobRegistry.getJobTypes();
    if (!types.includes(input.workerType)) {
      throw new Error(`Unknown worker type: ${input.workerType}`);
    }

    await workerDiscovery.updateDefaultOverrides(
      input.workerType,
      input.defaults,
    );

    return {
      success: true,
      workerType: input.workerType,
      defaults: input.defaults,
    };
  }

  extractActions(input: WorkerProgressRequest): {
    path: ResourcePath;
    actions: string[];
  }[] {
    switch (input.action) {
      case "list":
        return [{ path: ["jobs"], actions: ["read"] }];
      case "schemas":
        return [{ path: ["jobs"], actions: ["schemas"] }];
      case "cancel_all":
        return [{ path: ["jobs", "all"], actions: ["cancel"] }];
      case "clear_completed":
        return [{ path: ["jobs", "completed"], actions: ["delete"] }];
      case "clear_failed":
        return [{
          path: ["jobs", input.workerType, "failed"],
          actions: ["delete"],
        }];
      case "clear_queue":
        return [{ path: ["jobs", input.workerType], actions: ["cancel"] }];
      case "reset_worker":
        return [{
          path: ["jobs", input.workerType],
          actions: ["cancel", "pause", "resume", "enqueue"],
        }];
      case "cancel":
        return [{ path: ["jobs", input.id], actions: ["cancel"] }];
      case "dismiss_failed":
        return [{ path: ["jobs", input.id], actions: ["delete"] }];
      case "enqueue":
        return [{ path: ["jobs", input.data.type], actions: ["enqueue"] }];
      case "progressUpdate":
        return [{ path: ["jobs", input.jobId], actions: ["progressUpdate"] }];
      case "pause_worker":
        return [{ path: ["jobs", input.workerType], actions: ["pause"] }];
      case "resume_worker":
        return [{ path: ["jobs", input.workerType], actions: ["resume"] }];
      case "pause_all":
        return [{ path: ["jobs", "all"], actions: ["pause"] }];
      case "resume_all":
        return [{ path: ["jobs", "all"], actions: ["resume"] }];
      case "get_worker_status":
        return [{ path: ["jobs"], actions: ["read"] }];
      case "list_workers":
        return [{ path: ["jobs"], actions: ["read"] }];
      case "get_worker_defaults":
        return [{ path: ["jobs", input.workerType], actions: ["read"] }];
      case "update_worker_defaults":
        return [{ path: ["jobs", input.workerType], actions: ["configure"] }];
      case "stats":
        return [{ path: ["jobs"], actions: ["read"] }];
    }
    return [{ path: ["jobs"], actions: ["read", "write"] }];
  }
}

export async function getJobsResource(
  auth: Auth,
): Promise<(input: WorkerProgressRequest) => Promise<any>> {
  return auth.getResource("jobs");
}
