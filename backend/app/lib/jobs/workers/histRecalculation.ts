import type { Job } from "bullmq";
import type { JobData, JobResult } from "../types.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { updateAllHistogram } from "@/services/timeline.server.ts";

export async function processHistRecalculationJob(
  job: Job<JobData>,
): Promise<JobResult> {
  const jobData = job.data;
  if (jobData.type !== "histRecalculation") throw new Error("Invalid job type");

  const start = jobData.start ? new Date(jobData.start) : undefined;
  const end = jobData.end ? new Date(jobData.end) : undefined;
  
  if (!start || !end) {
    return { success: false, message: "Start or end date is required" };
  }

  const auth = await getServerAuth();
  await updateAllHistogram(auth, start, end);

  return { success: true };
}

