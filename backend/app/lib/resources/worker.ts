import { z } from "zod";
import { ObjectId } from "mongodb";
import { getServerAuth, type Auth } from "@/lib/auth/core.server.ts";
import type { Resource, ResourcePath } from "@/lib/auth/resources.ts";
import { getMongoResource } from "@/lib/mongo/core.server.ts";
import { jobRegistry } from "@/lib/jobs/job-registry.ts";
import { enqueueJob, EnqueueJobOptions, getQueue } from "@/lib/jobs/queue.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { workerPauseManager } from "@/lib/jobs/worker-pause-manager.ts";

const SERVER_CONFIG_ID = new ObjectId("000000000000000000000000");

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

const RequestSchema = z.union([
  UpdateProgressSchema,
  ListJobsSchema,
  CancelAllJobsSchema,
  CancelJobSchema,
  GetJobSchema,
  EnqueueJobSchema,
  SchemasSchema,
  PauseWorkerSchema,
  ResumeWorkerSchema,
  PauseAllSchema,
  ResumeAllSchema,
  GetWorkerStatusSchema,
]);

type WorkerProgressRequest = z.infer<typeof RequestSchema>;

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

  private async persistWorkerConfig(
    workerType: string,
    config: { paused: boolean },
    auth: Auth
  ) {
    const mongo = await getMongoResource(auth);
    
    await mongo({
      action: "updateOne",
      collection: "configs",
      query: { _id: SERVER_CONFIG_ID },
      update: {
        $set: {
          [`workers.${workerType}`]: config,
          updatedAt: new Date(),
        },
      },
    });
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
    }
    return [{ path: ["jobs"], actions: ["read", "write"] }];
  }
}

export async function getJobsResource(
  auth: Auth,
): Promise<(input: WorkerProgressRequest) => Promise<any>> {
  return auth.getResource("jobs");
}
