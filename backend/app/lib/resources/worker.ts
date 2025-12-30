import { z } from "zod";
import type { Auth } from "@/lib/auth/core.server.ts";
import type { Resource, ResourcePath } from "@/lib/auth/resources.ts";
import { JobDataSchema, JobTypeSchema } from "@/lib/jobs/types.ts";
import { enqueueJob, getQueue } from "@/lib/jobs/queue.ts";
import { publishJobUpdate } from "@/lib/events/publisher.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";

const UpdateProgressSchema = z.object({
  action: z.literal("progressUpdate"),
  jobId: z.string(),
  progress: z.record(z.string(), z.any()),
});

const ListJobsSchema = z.object({
  action: z.literal("list"),
  types: z.array(JobTypeSchema).nullable().optional(),
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

const EnqueueJobSchema = z.object({
  action: z.literal("enqueue"),
  data: JobDataSchema,
  priority: z.number().optional(),
});

const RequestSchema = z.union([
  UpdateProgressSchema,
  ListJobsSchema,
  CancelAllJobsSchema,
  EnqueueJobSchema,
]);

type WorkerProgressRequest = z.infer<typeof RequestSchema>;

export class WorkerProgressResource
  implements Resource<WorkerProgressRequest, any> {
  code = "jobs";
  description = "Update job progress, list jobs, or enqueue a new job";

  schemas = {
    request: RequestSchema,
    response: z.any(),
  };

  async use(input: WorkerProgressRequest): Promise<any> {
    switch (input.action) {
      case "enqueue":
        return this.enqueue(input);
      case "cancel_all":
        return this.cancelAll(input);
      case "list":
        return this.list(input);
      case "progressUpdate":
        return this.progressUpdate(input);
      default:
        throw new Error(`Unknown action: ${(input as any).action}`);
    }
  }

  private async enqueue(input: z.infer<typeof EnqueueJobSchema>) {
    const job = await enqueueJob(input.data, {
      priority: input.priority,
    });

    return {
      success: true,
      jobId: job.id,
    };
  }

  private async cancelAll(_input: z.infer<typeof CancelAllJobsSchema>) {
    const db = await getRootDB();
    const types = JobTypeSchema.options;
    for (const type of types) {
      const queue = getQueue(type);
      await queue.obliterate({ force: true });
    }

    await db.collection("jobs").updateMany(
      { state: { $in: ["waiting", "active", "delayed"] } },
      {
        $set: {
          state: "cancelled",
          finishedAt: new Date(),
          updatedAt: new Date(),
        },
      },
    );

    return { success: true };
  }

  private async list(input: z.infer<typeof ListJobsSchema>) {
    const db = await getRootDB();
    const types = input.types || JobTypeSchema.options;
    const queryStatuses = input.statuses ||
      ["active", "waiting", "delayed", "failed", "completed"];

    const totalLimit = input.limit || 100;

    const jobs = await db.collection("jobs")
      .find({
        type: { $in: types },
        state: { $in: queryStatuses },
      })
      .sort({ createdAt: -1 })
      .limit(totalLimit)
      .toArray();

    return jobs.map((job) => ({
      id: job._id.toString(),
      type: job.type,
      data: job.data,
      state: job.state,
      progress: job.progress,
      result: job.result,
      timestamp: job.createdAt.getTime(),
      finishedOn: job.finishedAt?.getTime(),
      processedOn: job.startedAt?.getTime(),
      failedReason: job.failedReason,
    }));
  }

  private async progressUpdate(input: z.infer<typeof UpdateProgressSchema>) {
    const db = await getRootDB();
    const { jobId, progress } = input;

    const jobDoc = await db.collection("jobs").findOne({ _id: jobId as any });
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

    await db.collection("jobs").updateOne(
      { _id: jobId as any },
      {
        $set: {
          progress,
          updatedAt: new Date(),
        },
      },
    );

    const queue = getQueue(jobType as any);
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
    });

    return { success: true };
  }

  extractActions(input: WorkerProgressRequest): {
    path: ResourcePath;
    actions: string[];
  }[] {
    switch (input.action) {
      case "list":
        return [{ path: ["jobs"], actions: ["read"] }];
      case "cancel_all":
        return [{ path: ["jobs"], actions: ["write"] }];
      case "enqueue":
        return [{ path: ["jobs"], actions: ["write"] }];
      case "progressUpdate":
        return [{ path: [], actions: ["write"] }];
    }
    return [{ path: ["jobs"], actions: ["read", "write"] }];
  }
}

export async function getJobsResource(
  auth: Auth,
): Promise<(input: WorkerProgressRequest) => Promise<any>> {
  return auth.getResource("jobs");
}
