import type { Job } from "bullmq";
import { z } from "zod";
import { env } from "#/env.ts";
import { callResource } from "@myceliasdk/resources.ts";
import type { JobCapability } from "@/lib/jobs/job-registry.ts";
import type { JobData, JobResult } from "@/lib/jobs/types.ts";

export const name = "objectListCatalogBackfill";

export const schema = z.object({
  type: z.literal(name),
  batchSize: z.number().int().min(1).max(1000).default(1000),
});

type ObjectListCatalogBackfillData = z.infer<typeof schema>;
type ObjectListCatalogBackfillResult = {
  processed: number;
  modified: number;
  complete: boolean;
  ready: boolean;
  lastBackfilledId?: unknown;
};

export async function use(job: Job<JobData>): Promise<JobResult> {
  const input = schema.parse(job.data) as ObjectListCatalogBackfillData;
  const jwt = Deno.env.get("MYCELIA_JWT")!;
  const result = await callResource("objects", {
    action: "repairListCatalog",
    batchSize: input.batchSize,
  }, { jwt, myceliaUrl: env.MYCELIA_URL }) as ObjectListCatalogBackfillResult;

  await job.updateProgress({
    stage: result.complete ? "validating" : "backfilling",
    processed: result.processed,
    modified: result.modified,
    lastBackfilledId: result.lastBackfilledId,
  });

  return {
    success: result.complete ? result.ready === true : true,
    processed: result.processed,
    modified: result.modified,
    hasMore: result.complete !== true,
    complete: result.complete,
    ready: result.ready,
    ...(result.complete && result.ready !== true
      ? { message: "Object list catalog parity validation failed" }
      : {}),
  };
}

const capability: JobCapability = {
  name,
  inputSchema: z.toJSONSchema(schema, { io: "input" }),
  outputSchema: z.toJSONSchema(z.object({
    success: z.boolean(),
    processed: z.number(),
    modified: z.number(),
    hasMore: z.boolean(),
    complete: z.boolean(),
    ready: z.boolean(),
    message: z.string().optional(),
  })),
  policies: [
    { resource: "objects", action: "update", effect: "allow" },
  ],
  maxConcurrency: 1,
  use,
};

export default capability;
