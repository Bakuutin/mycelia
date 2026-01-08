import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { getServerAuth } from "@/lib/auth/core.server.ts";
import { updateAllHistogram } from "@/services/timeline.server.ts";
import { zDateOrString } from "@/lib/zod-json-schema.ts";

import type { JobCapability } from "@/lib/jobs/job-registry.ts";

/** Job type name */
export const name = "histRecalculation";

/** Schema for histogram recalculation job data */
export const schema = z.object({
  type: z.literal("histRecalculation"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  all: z.boolean().default(false),
});

export type HistRecalculationJobData = z.infer<typeof schema>;

/** Process the histogram recalculation job */
export async function use(job: Job<JobData>): Promise<JobResult> {
  const jobData = job.data as HistRecalculationJobData;

  const start = jobData.start ? new Date(jobData.start) : undefined;
  const end = jobData.end ? new Date(jobData.end) : undefined;
  
  if (!start || !end) {
    return { success: false, message: "Start or end date is required" };
  }

  const auth = await getServerAuth();
  await updateAllHistogram(auth, start, end);

  return { success: true };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
  })),
  policies: [
    { resource: "db/audio_chunks", action: "read", effect: "allow" },
    { resource: "db/diarizations", action: "read", effect: "allow" },
    { resource: "db/transcriptions", action: "read", effect: "allow" },
    { resource: "db/histogram_*", action: "*", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
  ],
  use,
};

export default capability;
