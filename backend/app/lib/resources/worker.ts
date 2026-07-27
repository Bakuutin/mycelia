import { z } from "zod";
import { ObjectId } from "bson";
import { getServerAuth, type Auth } from "@/lib/auth/core.server.ts";
import type { Resource, ResourcePath } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { jobRegistry } from "@/lib/jobs/job-registry.ts";
import { enqueueJob, EnqueueJobOptions, getQueue } from "@/lib/jobs/queue.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { workerPauseManager } from "@/lib/jobs/worker-pause-manager.ts";
import { getConfigResource } from "@/lib/config/resource.server.ts";
import {
  assertJobServicesHealthy,
  getExternalServicesHealth,
} from "@/lib/jobs/service-health.ts";

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

const CancelJobSchema = z.object({
  action: z.literal("cancel"),
  id: z.string(),
});

const GetJobSchema = z.object({
  action: z.literal("get"),
  id: z.string(),
});

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

const RequestSchema = z.union([
  UpdateProgressSchema,
  ListJobsSchema,
  CancelAllJobsSchema,
  ClearCompletedJobsSchema,
  ClearFailedJobsSchema,
  ClearQueueSchema,
  CancelJobSchema,
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
]);

type WorkerProgressRequest = z.infer<typeof RequestSchema>;

export function getFailedJobsQuery(workerType: string) {
  return {
    type: workerType,
    state: "failed",
  } as const;
}

export class JobsResource
  implements Resource<WorkerProgressRequest, any> {
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
      case "cancel_all":
        return this.cancelAll(input, auth);
      case "clear_completed":
        return this.clearCompleted(input, auth);
      case "clear_failed":
        return this.clearFailed(input, auth);
      case "clear_queue":
        return this.clearQueue(input, auth);
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

    await mongo({
      action: "updateOne",
      collection: "jobs",
      query: { _id: new ObjectId(id) },
      update: {
        $set: {
          state: "cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });

    await publishJobUpdate(id, jobType, "job.state", {
      state: "cancelled",
      finishedOn: Date.now(),
    });

    return { success: true };
  }

  private async cancelAll(_input: z.infer<typeof CancelAllJobsSchema>, auth: Auth) {
    const mongo = await getMongoResource(auth);

    const types = jobRegistry.getJobTypes();
    for (const type of types) {
      const queue = getQueue(type);
      await queue.obliterate({ force: true });
    }

    await mongo({
      action: "updateMany",
      collection: "jobs",
      query: { state: { $in: ["waiting", "active", "delayed"] } },
      update: {
        $set: {
          state: "cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    });

    return { success: true };
  }

  private async clearCompleted(_input: z.infer<typeof ClearCompletedJobsSchema>, auth: Auth) {
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
      },
      options: { sort: { createdAt: 1 }, limit: input.limit },
    }) as any[];

    const serverAuth = await getServerAuth();
    const retried: Array<{ failedJobId: string; retryJobId: string }> = [];
    const errors: string[] = [];

    for (const failedJob of failedJobs) {
      try {
        const retryJob = await enqueueJob(failedJob.data, {
          trigger: {
            type: "manual",
            reason: `retry_failed:${failedJob._id.toString()}`,
          },
        }, serverAuth);
        const retriedAt = new Date();
        await mongo({
          action: "updateOne",
          collection: "jobs",
          query: { _id: failedJob._id },
          update: {
            $set: {
              retriedAt,
              retryJobId: retryJob.id,
              updatedAt: retriedAt,
            },
          },
        });
        retried.push({
          failedJobId: failedJob._id.toString(),
          retryJobId: retryJob.id!,
        });
      } catch (error) {
        errors.push(
          `${failedJob._id.toString()}: ${
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
      retried,
      errors,
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
      summaryReadyResult,
      failedByWorker,
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
        collection: "objects",
        pipeline: [
          {
            $match: {
              isConversation: true,
              "summaries.0": { $exists: false },
            },
          },
          { $unwind: "$timeRanges" },
          {
            $lookup: {
              from: "transcriptions",
              let: {
                rangeStart: "$timeRanges.start",
                rangeEnd: "$timeRanges.end",
              },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $lte: ["$start", "$$rangeEnd"] },
                        { $gte: ["$end", "$$rangeStart"] },
                      ],
                    },
                  },
                },
                { $limit: 1 },
              ],
              as: "matchingTranscriptions",
            },
          },
          { $match: { "matchingTranscriptions.0": { $exists: true } } },
          { $group: { _id: "$_id" } },
          { $count: "count" },
        ],
      }),
      mongo({
        action: "aggregate",
        collection: "jobs",
        pipeline: [
          {
            $match: {
              state: "failed",
              retriedAt: { $exists: false },
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
    ]);

    const summaryReady = Number(summaryReadyResult?.[0]?.count ?? 0);
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
          ready: summaryReady,
          missingTotal: Number(summariesMissing),
          blockedWithoutTranscripts: Math.max(
            0,
            Number(summariesMissing) - summaryReady,
          ),
          failedJobsUnretried: Number(failedCounts.summarization ?? 0),
        },
      },
      recovery: {
        startupChecks: true,
        periodicRetrySeconds: 300,
        note:
          "Failed job history is retained. Retryable source records are checked on startup and every 5 minutes after dependencies recover.",
      },
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
    }));
  }

  private async progressUpdate(input: z.infer<typeof UpdateProgressSchema>, auth: Auth) {
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

  private async pauseWorker(input: z.infer<typeof PauseWorkerSchema>, auth: Auth) {
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

  private async resumeWorker(input: z.infer<typeof ResumeWorkerSchema>, auth: Auth) {
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
    // TODO: worker specific logic should belong to the worker file

    // Get overall counts by status (across ALL jobs, not limited)
    const statusCountsPipeline = [
      {
        $group: {
          _id: "$state",
          count: { $sum: 1 }
        }
      }
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
      {
        $group: {
          _id: "$type",
          totalRuns: { $sum: 1 },
          active: {
            $sum: { $cond: [{ $eq: ["$state", "active"] }, 1, 0] }
          },
          waiting: {
            $sum: { $cond: [{ $eq: ["$state", "waiting"] }, 1, 0] }
          },
          delayed: {
            $sum: { $cond: [{ $eq: ["$state", "delayed"] }, 1, 0] }
          },
          completed: {
            $sum: { $cond: [{ $eq: ["$state", "completed"] }, 1, 0] }
          },
          failed: {
            $sum: { $cond: [{ $eq: ["$state", "failed"] }, 1, 0] }
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
                            { $eq: [{ $ifNull: ["$result.hasSpeech", { $ifNull: ["$progress.hasSpeech", -1] }] }, 0] },
                            { $eq: [{ $ifNull: ["$result.processed", { $ifNull: ["$progress.processed", -1] }] }, 0] }
                          ]
                        },
                        // conversation_chunk_creator: finalized=0 and streamed=0 and chunksCreated=0
                        {
                          $and: [
                            { $eq: ["$type", "conversation_chunk_creator"] },
                            { $eq: [{ $ifNull: ["$result.finalized", 0] }, 0] },
                            { $eq: [{ $ifNull: ["$result.streamed", 0] }, 0] },
                            { $eq: [{ $ifNull: ["$result.chunksCreated", 0] }, 0] }
                          ]
                        },
                        // conversation_extractor: conversationsCreated=0 and chunksProcessed=0
                        {
                          $and: [
                            { $eq: ["$type", "conversation_extractor"] },
                            { $eq: [{ $ifNull: ["$result.conversationsCreated", 0] }, 0] },
                            { $eq: [{ $ifNull: ["$result.chunksProcessed", 0] }, 0] }
                          ]
                        },
                        // transcription_sequence_creator: processed=0
                        {
                          $and: [
                            { $eq: ["$type", "transcription_sequence_creator"] },
                            { $eq: [{ $ifNull: ["$result.processed", 0] }, 0] }
                          ]
                        },
                        // transcription: processed=0
                        {
                          $and: [
                            { $eq: ["$type", "transcription"] },
                            { $eq: [{ $ifNull: ["$result.processed", { $ifNull: ["$progress.processed", -1] }] }, 0] }
                          ]
                        },
                        // Generic: processed=0 and total=0 for other types
                        {
                          $and: [
                            { $not: { $in: ["$type", ["vad", "conversation_chunk_creator", "conversation_extractor", "transcription_sequence_creator", "transcription", "summarization"]] } },
                            { $eq: [{ $ifNull: ["$result.processed", { $ifNull: ["$progress.processed", -1] }] }, 0] },
                            { $eq: [{ $ifNull: ["$result.total", { $ifNull: ["$progress.total", -1] }] }, 0] }
                          ]
                        }
                      ]
                    }
                  ]
                },
                1,
                0
              ]
            }
          },
          // Get timestamps for frequency calculation (last 20)
          recentTimestamps: {
            $push: {
              $cond: [
                { $eq: ["$state", "completed"] },
                { $toLong: "$createdAt" },
                null
              ]
            }
          }
        }
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
              { $multiply: [{ $divide: ["$completed", "$totalRuns"] }, 100] }
            ]
          },
          // Filter out nulls and get last 20 timestamps
          recentTimestamps: {
            $slice: [
              { $filter: { input: "$recentTimestamps", as: "ts", cond: { $ne: ["$$ts", null] } } },
              -20
            ]
          }
        }
      }
    ];

    const stats = await mongo({
      action: "aggregate",
      collection: "jobs",
      pipeline,
    });

    // Calculate frequency from timestamps
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
        else if (avgMs < 3600000) avgFrequency = `~${Math.round(avgMs / 60000)}m`;
        else avgFrequency = `~${(avgMs / 3600000).toFixed(1)}h`;
      }

      return {
        type: stat.type,
        totalRuns: stat.totalRuns ?? 0,
        active: stat.active ?? 0,
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
    auth: Auth
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

  private async getWorkerDefaults(input: z.infer<typeof GetWorkerDefaultsSchema>, _auth: Auth) {
    const { workerDiscovery } = await import("@/lib/jobs/worker-discovery.ts");
    const defaults = await workerDiscovery.getDefaultOverrides(input.workerType);
    
    return { 
      workerType: input.workerType,
      defaults: defaults || {} 
    };
  }

  private async updateWorkerDefaults(input: z.infer<typeof UpdateWorkerDefaultsSchema>, _auth: Auth) {
    const { workerDiscovery } = await import("@/lib/jobs/worker-discovery.ts");
    
    // Verify worker type exists
    const types = jobRegistry.getJobTypes();
    if (!types.includes(input.workerType)) {
      throw new Error(`Unknown worker type: ${input.workerType}`);
    }
    
    await workerDiscovery.updateDefaultOverrides(input.workerType, input.defaults);
    
    return { 
      success: true,
      workerType: input.workerType,
      defaults: input.defaults
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
      case "cancel":
        return [{ path: ["jobs", input.id], actions: ["cancel"] }];
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
