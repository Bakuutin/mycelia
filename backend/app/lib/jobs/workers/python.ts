import type { Job } from "bullmq";
import type { JobData, JobResult } from "../types.ts";

export async function processPythonJob(
  job: Job<JobData>,
): Promise<JobResult> {
  const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") ||
    "http://localhost:8000";

  const jobType = job.data.type;
  const url = `${PYTHON_WORKER_URL}/jobs/${jobType}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
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

