import type { Job } from "bullmq";
import { z } from "zod";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { env } from "#/env.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";
import { getRootDB } from "@/lib/mongo/core.server.ts";
import { rebuildObjectTimelineDensity } from "@/lib/objects/timeline-density.worker.ts";

export const name = "objectTimelineDensityRebuild";

export const schema = z.object({
  type: z.literal(name),
  windowDays: z.number().int().min(1).max(31).default(31),
}).strict();

type ObjectTimelineDensityRebuildData = z.infer<typeof schema>;

export function parseObjectTimelineDensityInput(
  data: JobData,
): ObjectTimelineDensityRebuildData {
  // The isolated launcher adds internal metadata (for example `id` and
  // `routingContext`) after the public strict schema has validated the job.
  // Select only the worker's public fields here so those internal keys cannot
  // accidentally turn a valid queued job into a runtime schema failure.
  return schema.parse({
    type: data.type,
    windowDays: data.windowDays,
  });
}

export function mongoAllowedHosts(mongoUrl: string | undefined): string[] {
  const afterScheme = (mongoUrl ?? "").split("://", 2)[1] ?? "";
  const authorityEnd = afterScheme.search(/[/?#]/);
  const authority = authorityEnd === -1
    ? afterScheme
    : afterScheme.slice(0, authorityEnd);
  const hosts = authority.split("@").at(-1) ?? "";
  return hosts.split(",").map((host) => host.trim()).filter(Boolean);
}

export async function use(job: Job<JobData>): Promise<JobResult> {
  const input = parseObjectTimelineDensityInput(job.data);
  const db = await getRootDB();
  await job.updateProgress({ stage: "rebuilding", scope: "full" });
  const result = await rebuildObjectTimelineDensity(db, {
    leaseOwner: `job:${job.id ?? "unknown"}`,
    windowMs: input.windowDays * 24 * 60 * 60 * 1_000,
    onProgress: async ({ start, end, processedThrough }) => {
      await job.updateProgress({
        stage: "rebuilding",
        scope: "full",
        start,
        end,
        processedThrough,
      });
    },
  });
  await job.updateProgress({
    stage: result.ready ? "ready" : "repair-required",
    sourceObjects: result.sourceObjects,
  });
  return {
    success: result.ready,
    processed: result.sourceObjects,
    sourceObjects: result.sourceObjects,
    start: result.start,
    end: result.end,
    ready: result.ready,
    hasMore: false,
    ...(!result.ready
      ? { message: "Density changed without a durable queue record" }
      : {}),
  };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
    processed: z.number(),
    sourceObjects: z.number(),
    start: zDateOrString().optional(),
    end: zDateOrString().optional(),
    ready: z.boolean(),
    hasMore: z.boolean(),
    message: z.string().optional(),
  })),
  policies: [
    { resource: "objects", action: "update", effect: "allow" },
  ],
  allowedHosts: mongoAllowedHosts(env.MONGO_URL),
  maxConcurrency: 1,
  use,
};

export default capability;
