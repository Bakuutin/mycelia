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

// Use a discriminated union if possible, but for mixed schemas where discriminator is optional, 
// we need to be careful.
// UpdateProgressSchema has optional action 'update_progress', or undefined.
// ListJobsSchema has required action 'list'.
//
// Zod unions try each schema in order.
// If input is { action: 'list', ... }, it fails UpdateProgressSchema (action mismatch).
// Then it tries ListJobsSchema.
//
// If input is { jobId: '...', ... } (no action), it matches UpdateProgressSchema.
//
// The error suggests it tried to match ListJobsSchema against { action: "list" } but failed on other fields?
// No, the error shows it failed to match the input against EITHER schema.
//
// The error details show "invalid_union" with errors for both branches.
//
// Branch 0 (UpdateProgressSchema):
// - "invalid_value" at ["action"]: expected "update_progress" (input had "list")
//
// Branch 1 (ListJobsSchema):
// - "invalid_type" at ["types"]: expected array, received null (input had types: null?)
//
// Ah, the error message says:
// path: ["types"], message: "Invalid input: expected array, received null"
//
// This means the frontend sent `types: null` explicitly?
// Or maybe `undefined` serialized as `null` in JSON?
//
// Let's check JobsPage.tsx:
// types: filterType === "all" ? undefined : [filterType],
//
// If undefined is sent in JSON.stringify, the key is omitted.
// So input would be { action: "list", limit: 50 }.
//
// Wait, if the key is missing, z.array(...).optional() should handle it.
// UNLESS the input actually has `types: null`.
//
// The error says "received null". So `types` key exists and is null.
//
// In backend/app/lib/resources/worker.ts:
// types: z.array(JobTypeSchema).optional()
//
// .optional() handles undefined, but NOT null.
// .nullable() handles null.
//
// If the API client or some middleware converts undefined to null, that's the issue.
// Or if JSON.stringify preserves it as null? No, JSON.stringify({a: undefined}) -> {}.
//
// Let's check how api.callResource sends data.
// It uses EJSON.stringify(body).
// EJSON might serialize undefined differently or the frontend logic result is actually null?
//
// In JobsPage.tsx:
// filterType === "all" ? undefined : [filterType]
//
// If filterType is "all", it returns undefined.
//
// Let's make the schema more permissive: .nullable().optional()

const RequestSchema = z.union([UpdateProgressSchema, ListJobsSchema]);

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
    // Handle "list" action
    if ("action" in input && input.action === "list") {
      const types = input.types || JobTypeSchema.options;
      const statuses = input.statuses || [
        "active",
        "waiting",
        "delayed",
        "paused",
        "failed",
        "completed", // include completed by default? might be too many.
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

  extractActions(): { path: string[]; actions: string[] }[] {
    return [{ path: [], actions: ["read", "write"] }];
  }
}

export async function getWorkerProgressResource(
  auth: Auth,
): Promise<(input: WorkerProgressRequest) => Promise<void | JobInfo[]>> {
  return auth.getResource("worker_progress");
}
