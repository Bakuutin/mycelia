import { z } from "zod";
import type { Auth } from "@/lib/auth/core.server.ts";
import type { Resource } from "@/lib/auth/resources.ts";
import { JobTypeSchema } from "@/lib/jobs/types.ts";
import { getQueue } from "@/lib/jobs/queue.ts";
import { redis } from "@/lib/redis.ts";
import type { Job } from "bullmq";
import { publishJobUpdate } from "@/lib/events/publisher.ts";

const UpdateProgressSchema = z.object({
  action: z.literal("update_progress").optional(),
  jobId: z.string(),
  jobType: JobTypeSchema,
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


const RequestSchema = z.union([UpdateProgressSchema, ListJobsSchema, CancelAllJobsSchema]);

type WorkerProgressRequest = z.infer<typeof RequestSchema>;

type JobInfo = {
  id: string | undefined;
  type: string;
  data: any;
  state: string;
  progress: any;
  result?: any;
  timestamp: number;
  finishedOn?: number;
  processedOn?: number;
  failedReason?: string;
};

export class WorkerProgressResource
  implements Resource<WorkerProgressRequest, void | JobInfo[]> {
  code = "worker_progress";
  description = "Update job progress or list jobs";

  schemas = {
    request: RequestSchema,
    response: z.any(), // Returning JobInfo[] or void
  };

  async use(input: WorkerProgressRequest): Promise<void | JobInfo[]> {
    // Handle "cancel_all" action
    if ("action" in input && input.action === "cancel_all") {
      const types = JobTypeSchema.options;
      for (const type of types) {
        const queue = getQueue(type);
        // We use obliterate to clear the queue completely.
        // force: true is required if there are active jobs.
        await queue.obliterate({ force: true });
      }
      return;
    }

    // Handle "list" action
    if ("action" in input && input.action === "list") {
      const types = input.types || JobTypeSchema.options;
      const statuses = input.statuses || [
        "active",
        "waiting",
        "delayed",
        "paused",
        "failed",
        "completed",
      ];
      // Default statuses if not provided: active, waiting, delayed, failed.
      // If user asks for 'list', they likely want to see what's happening.
      const queryStatuses = input.statuses ||
        ["active", "waiting", "delayed", "failed", "completed"];

      const allJobs: JobInfo[] = [];

      for (const type of types) {
        const queue = getQueue(type);
        const jobs = await queue.getJobs(queryStatuses, 0, input.limit ? input.limit - 1 : 99);
        
        // Parallelize state fetching
        const jobsWithState = await Promise.all(jobs.map(async (job) => {
             const state = await job.getState();
             return { job, state };
        }));

        for (const { job, state } of jobsWithState) {
          allJobs.push({
            id: job.id,
            type: type,
            data: job.data,
            state,
            progress: job.progress,
            result: job.returnvalue,
            timestamp: job.timestamp,
            finishedOn: job.finishedOn,
            processedOn: job.processedOn,
            failedReason: job.failedReason,
          });
        }
      }

      // Sort by timestamp descending
      return allJobs.sort((a, b) => b.timestamp - a.timestamp);
    }

    // Handle "update_progress" action (or legacy format)
    // Legacy format doesn't have 'action', but matches UpdateProgressSchema structure
    const { jobId, jobType, progress } = input as z.infer<
      typeof UpdateProgressSchema
    >;

    const queue = getQueue(jobType);
    const job = await queue.getJob(jobId);

    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    await job.updateProgress(progress);

    const streamKey = `progress:${jobType}:${jobId}`;
    const fields: string[] = [];

    for (const [key, value] of Object.entries(progress)) {
      fields.push(key, String(value));
    }

    fields.push("timestamp", new Date().toISOString());

    await redis.xadd(streamKey, "*", ...fields);
    await redis.expire(streamKey, 3600);

    await publishJobUpdate(jobId, jobType, "job.progress", {
      state: await job.getState(),
      progress,
    });
  }

  extractActions(input: WorkerProgressRequest): { path: string[]; actions: string[] }[] {
    switch (input.action) {
      case "list":
        return [{ path: ["jobs"], actions: ["read"] }];
      case "cancel_all":
        return [{ path: ["jobs"], actions: ["write"] }];
      case "update_progress":
        return [{ path: [], actions: ["write"] }];
    }
    return [{ path: ["jobs"], actions: ["read", "write"] }];
  }
}

export async function getWorkerProgressResource(
  auth: Auth,
): Promise<(input: WorkerProgressRequest) => Promise<void | JobInfo[]>> {
  return auth.getResource("worker_progress");
}
