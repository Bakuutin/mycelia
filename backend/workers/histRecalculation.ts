import type { Job } from "bullmq";
import { z } from "zod";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import { updateAllHistogram } from "@/services/timeline.server.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";

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

  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const myceliaUrl = env.MYCELIA_URL;

  const auth = {
    getResource: (code: string) => (input: any) => callResource(code, input, { jwt, myceliaUrl })
  } as any;

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
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "*", effect: "allow" },
    { resource: "db/transcriptions", action: "*", effect: "allow" },
    { resource: "db/histogram_*", action: "*", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
  ],
  use,
};

export default capability;
