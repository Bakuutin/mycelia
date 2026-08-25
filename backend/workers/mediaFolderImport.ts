import type { Job } from "bullmq";
import { z } from "zod";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { JobData } from "@/lib/jobs/types.ts";
import { callResource } from "@myceliasdk/resources.ts";

const schema = z.object({
  type: z.literal("mediaFolderImport"),
  campaignId: z.string().optional(),
});

const output = z.object({
  success: z.boolean(),
  idle: z.boolean().optional(),
  campaignId: z.string().optional(),
  processed: z.number().int().nonnegative().optional(),
  hasMore: z.boolean().optional(),
});

const capability: JobCapability = {
  name: "mediaFolderImport",
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(output),
  policies: [
    {
      resource: "media-library/processFolderCampaign",
      action: "process",
      effect: "allow",
    },
  ],
  maxConcurrency: 1,
  triggers: {
    sources: [],
    debounceMs: 1_000,
    interval: 30,
  },
  hasPendingWork: async ({ mongo }) => {
    const rows = await mongo({
      action: "find",
      collection: "media_folder_campaigns",
      query: { status: { $in: ["queued", "scanning", "importing"] } },
      options: { projection: { _id: 1 }, limit: 1 },
    });
    return Array.isArray(rows) && rows.length > 0 ? 1 : 0;
  },
  use: async (job: Job<JobData>) => {
    const jwt = Deno.env.get("MYCELIA_JWT");
    const myceliaUrl = Deno.env.get("MYCELIA_URL");
    if (!jwt || !myceliaUrl) {
      throw new Error("Media folder worker resource context is missing");
    }
    return await callResource("media-library", {
      action: "processFolderCampaign",
      ...(typeof job.data.campaignId === "string"
        ? { campaignId: job.data.campaignId }
        : {}),
      jobId: job.id,
    }, { jwt, myceliaUrl }) as Record<string, unknown>;
  },
};

export default capability;
