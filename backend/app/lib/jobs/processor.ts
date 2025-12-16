import type { Job } from "bullmq";
import type { JobData, JobResult } from "./types.ts";
import { getWorker } from "./workers/registry.ts";

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  const jobType = job.data.type;
  const worker = getWorker(jobType);
  return await worker(job);
}
