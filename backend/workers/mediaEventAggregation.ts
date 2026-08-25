import type { Job } from "bullmq";
import { z } from "zod";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { JobData } from "@/lib/jobs/types.ts";
import { callResource } from "@myceliasdk/resources.ts";

const schema = z.object({
  type: z.literal("mediaEventAggregation"),
  eventId: z.string().min(1),
  profileSnapshot: z.record(z.string(), z.unknown()),
  consentReceiptId: z.string().min(1),
  retryNonce: z.string().min(1).optional(),
});

const capability: JobCapability = {
  name: "mediaEventAggregation",
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
    eventId: z.string(),
    runId: z.string().optional(),
    reused: z.boolean().optional(),
    inProgress: z.boolean().optional(),
    retryAt: z.string().datetime().optional(),
  })),
  policies: [
    {
      resource: "media-events/processEvent",
      action: "process",
      effect: "allow",
    },
  ],
  maxConcurrency: 1,
  use: async (job: Job<JobData>) => {
    const jwt = Deno.env.get("MYCELIA_JWT");
    const myceliaUrl = Deno.env.get("MYCELIA_URL");
    if (!jwt || !myceliaUrl) {
      throw new Error("Media event worker resource context is missing");
    }
    return await callResource("media-events", {
      action: "processEvent",
      eventId: String(job.data.eventId),
      profileSnapshot: job.data.profileSnapshot as Record<string, unknown>,
      consentReceiptId: String(job.data.consentReceiptId),
      retryNonce: typeof job.data.retryNonce === "string"
        ? job.data.retryNonce
        : undefined,
      jobId: job.id,
    }, { jwt, myceliaUrl }) as Record<string, unknown>;
  },
};

export default capability;
