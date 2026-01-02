import type { Job } from "bullmq";
import type { JobData, JobResult } from "./types.ts";
import { jobRegistry } from "./job-registry.ts";

export async function processJob(job: Job<JobData>): Promise<JobResult> {
  return jobRegistry.process(job);
}
