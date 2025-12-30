import type { Job } from "bullmq";
import type { JobData, JobResult } from "../types.ts";
import { env } from "#/env.ts";
import { signJWT } from "@/lib/auth/tokens.ts";

export async function processPythonJob(
  job: Job<JobData>,
): Promise<JobResult> {
  const PYTHON_WORKER_URL = env.PYTHON_WORKER_URL;

  const jobType = job.data.type;
  const url = `${PYTHON_WORKER_URL}/jobs/${jobType}`;

  // Issue a single-use JWT for this job
  const token = await signJWT(
    "job-worker",
    `job:${job.id}`,
    [{ resource: "**", action: "*", effect: "allow" }],
    "1 hour",
  );

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({
      jobId: job.id,
      data: job.data,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Python worker failed (${response.status}): ${errorText}`,
    );
  }

  const result = await response.json();
  return result;
}


