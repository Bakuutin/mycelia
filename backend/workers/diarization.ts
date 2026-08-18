import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";
import {
  DEFAULT_DIARIZATION_MAX_SEQUENCE_CHUNKS,
  MAX_DIARIZATION_BATCH_SIZE,
  MAX_DIARIZATION_SEQUENCE_CHUNKS,
} from "@/lib/jobs/job-timeouts.ts";

export function getDefaultDiarizationMaxSequenceChunks(
  value = Deno.env.get("DIARIZATION_MAX_SEQUENCE_CHUNKS"),
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1
    ? Math.min(parsed, MAX_DIARIZATION_SEQUENCE_CHUNKS)
    : DEFAULT_DIARIZATION_MAX_SEQUENCE_CHUNKS;
}

/** Schema for diarization job data */
export const schema = z.object({
  type: z.literal("diarization"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  limit: z.number().int().positive().max(100).default(4),
  batchSize: z.number().int().positive().max(MAX_DIARIZATION_BATCH_SIZE)
    .default(4).describe(
      "Speech sequences processed per job; continuations drain the campaign",
    ),
  maxSequenceChunks: z.number().int().positive()
    .max(MAX_DIARIZATION_SEQUENCE_CHUNKS)
    .default(getDefaultDiarizationMaxSequenceChunks())
    .describe(
      "Maximum chunks per speech sequence, snapshotted for worker timeout calculation",
    ),
  mode: z.enum(["missing", "build_generation"]).default("missing"),
  runId: z.string().min(1).optional(),
  cursor: zDateOrString().optional(),
  diarizationServerUrl: z.string().url().optional(),
  campaignId: z.string().min(1).optional(),
  originalId: z.string().min(1).optional(),
});

const PYTHON_WORKER_URL = Deno.env.get("PYTHON_WORKER_URL") ||
  "http://localhost:8000";

type MongoResource = (request: Record<string, unknown>) => Promise<unknown>;

function campaignChunkQuery(
  campaign: Record<string, any>,
  options: { readyOnly: boolean },
): Record<string, unknown> {
  const start: Record<string, unknown> = {};
  if (campaign.range?.start) start.$gte = campaign.range.start;
  if (campaign.range?.end) start.$lte = campaign.range.end;

  return {
    "vad.has_speech": true,
    diarized_at: null,
    "diarizationFailure.status": { $ne: "needs_attention" },
    ...(Object.keys(start).length > 0 ? { start } : {}),
    ...(campaign.originalId ? { original_id: campaign.originalId } : {}),
    ...(options.readyOnly
      ? {
        processing_by: null,
        "diarizationFailure.retryAt": { $not: { $gt: new Date() } },
      }
      : {}),
  };
}

async function findPendingChunk(
  mongo: MongoResource,
  query: Record<string, unknown>,
): Promise<boolean> {
  const pending = await mongo({
    action: "find",
    collection: "audio_chunks",
    query,
    options: { projection: { _id: 1 }, limit: 1 },
  }) as unknown[];
  return pending.length > 0;
}

async function findOpenHistoricalCampaigns(
  mongo: MongoResource,
): Promise<Record<string, any>[]> {
  const campaigns = await mongo({
    action: "find",
    collection: "diarization_campaigns",
    query: {
      mode: "missing",
      status: { $in: ["counting", "running", "interrupted"] },
      $or: [{ originalId: null }, { originalId: { $exists: false } }],
    },
    // There should be one campaign, but legacy/manual launches could leave
    // several open records. A bounded list lets the watchdog reconcile stale
    // fixed ranges without turning this into an unbounded maintenance scan.
    options: { sort: { updatedAt: -1 }, limit: 50 },
  }) as Record<string, any>[];
  return campaigns ?? [];
}

async function completeExhaustedCampaign(
  mongo: MongoResource,
  campaign: Record<string, any>,
): Promise<void> {
  const now = new Date();
  await mongo({
    action: "updateOne",
    collection: "diarization_campaigns",
    query: {
      campaignId: campaign.campaignId,
      status: { $in: ["counting", "running", "interrupted"] },
    },
    update: {
      $set: {
        status: Number(campaign.errorCount ?? 0) > 0
          ? "completed_with_errors"
          : "completed",
        pendingChunks: 0,
        currentJobId: null,
        nextRetryAt: null,
        finishedAt: now,
        reconciledAt: now,
        reconciliationReason: "no_unresolved_chunks_in_campaign_range",
        updatedAt: now,
      },
    },
  });
}

export default new NetworkJobCapability({
  name: "diarization",
  schema,
  url: `${PYTHON_WORKER_URL}/jobs/diarization`,
  policies: [
    { resource: "config/read", action: "read", effect: "allow" },
    { resource: "db/configs", action: "read", effect: "allow" },
    { resource: "db/audio_chunks", action: "*", effect: "allow" },
    { resource: "db/diarizations", action: "read", effect: "allow" },
    { resource: "db/diarizations", action: "write", effect: "allow" },
    { resource: "db/diarizations", action: "update", effect: "allow" },
    { resource: "db/diarization_runs", action: "*", effect: "allow" },
    { resource: "db/diarization_campaigns", action: "*", effect: "allow" },
    {
      resource: "db/diarization_recording_leases",
      action: "*",
      effect: "allow",
    },
    {
      resource: "db/diarization_campaign_rate_samples",
      action: "*",
      effect: "allow",
    },
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
  ],
  maxConcurrency: 1,
  hasPendingWork: async ({ mongo }) => {
    // Reconcile an exhausted fixed-range campaign before provider routing.
    // Otherwise an unavailable diarizator prevents the database-only cleanup,
    // and the watchdog keeps trying the same already-covered range forever.
    const campaigns = await findOpenHistoricalCampaigns(mongo);
    const states = new Map<string, { ready: boolean; unresolved: boolean }>();
    const completed = new Set<string>();

    // Reconcile every bounded fixed-range campaign, not only the newest one.
    // Older manual campaigns otherwise stay "running" forever behind a newer
    // global backfill even though their selected range is already covered.
    for (const candidate of campaigns) {
      if (!candidate.range?.start && !candidate.range?.end) continue;
      const ready = await findPendingChunk(
        mongo,
        campaignChunkQuery(candidate, { readyOnly: true }),
      );
      const unresolved = ready || await findPendingChunk(
        mongo,
        campaignChunkQuery(candidate, { readyOnly: false }),
      );
      states.set(candidate.campaignId, { ready, unresolved });
      if (!unresolved) {
        await completeExhaustedCampaign(mongo, candidate);
        completed.add(candidate.campaignId);
      }
    }

    const campaign = campaigns.find((candidate) =>
      !completed.has(candidate.campaignId)
    );
    if (campaign) {
      const state = states.get(campaign.campaignId) ?? {
        ready: await findPendingChunk(
          mongo,
          campaignChunkQuery(campaign, { readyOnly: true }),
        ),
        unresolved: false,
      };
      if (state.ready) {
        // This is an existence check, not a backlog estimate. Returning true
        // lets the trigger manager fill every free provider slot immediately.
        return true;
      }

      // A claimed chunk or a retry whose delay has not elapsed is unresolved,
      // not completed. Wait for claim recovery/retry eligibility without
      // creating empty jobs every five minutes.
      const unresolved = state.unresolved || await findPendingChunk(
        mongo,
        campaignChunkQuery(campaign, { readyOnly: false }),
      );
      if (unresolved) {
        return false;
      }

      await completeExhaustedCampaign(mongo, campaign);
    }

    // Trigger checks only need existence. Counting the entire historical
    // backlog every 300 seconds delayed both startup and batch continuation.
    return await findPendingChunk(
      mongo,
      campaignChunkQuery({}, {
        readyOnly: true,
      }),
    );
  },
  getTriggerJobData: async (_payload, _reason, { mongo }) => {
    const campaign = (await findOpenHistoricalCampaigns(mongo))[0];
    if (campaign) {
      return {
        type: "diarization",
        mode: "missing",
        campaignId: campaign.campaignId,
        ...(campaign.range?.start ? { start: campaign.range.start } : {}),
        ...(campaign.range?.end ? { end: campaign.range.end } : {}),
      };
    }
    const now = new Date();
    const oldest = (await mongo({
      action: "find",
      collection: "audio_chunks",
      query: {
        "vad.has_speech": true,
        $or: [{ diarized_at: { $exists: false } }, { diarized_at: null }],
      },
      options: { sort: { start: 1 }, limit: 1, projection: { start: 1 } },
    }) as any[])?.[0];
    return {
      type: "diarization",
      mode: "missing",
      campaignId: `diarization-historical-${crypto.randomUUID()}`,
      end: now,
      ...(oldest?.start ? { start: oldest.start } : {}),
    };
  },
  triggers: {
    sources: [],
    ...getTriggerTiming("diarization"),
  },
});
