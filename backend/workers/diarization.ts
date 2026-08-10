import { z } from "zod";
import { NetworkJobCapability } from "./python.ts";
import { zDateOrString } from "@myceliasdk/zod-json-schema.ts";
import { getTriggerTiming } from "@/lib/jobs/trigger-config.ts";

/** Schema for diarization job data */
export const schema = z.object({
  type: z.literal("diarization"),
  start: zDateOrString().optional(),
  end: zDateOrString().optional(),
  limit: z.number().int().positive().max(100).default(4),
  batchSize: z.number().int().positive().max(100).default(4).describe(
    "Speech sequences processed per job; continuations drain the campaign",
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
    { resource: "db/speaker_profiles", action: "read", effect: "allow" },
  ],
  maxConcurrency: 1,
  hasPendingWork: async ({ mongo }) => {
    // Trigger checks only need existence. Counting the entire historical
    // backlog every 300 seconds delayed both startup and batch continuation.
    const pending = await mongo({
      action: "find",
      collection: "audio_chunks",
      query: {
        "vad.has_speech": true,
        $and: [
          { $or: [{ diarized_at: { $exists: false } }, { diarized_at: null }] },
          {
            $or: [{ processing_by: { $exists: false } }, {
              processing_by: null,
            }],
          },
          {
            $or: [
              { "diarizationFailure.status": { $exists: false } },
              { "diarizationFailure.status": { $ne: "needs_attention" } },
            ],
          },
        ],
      },
      options: { projection: { _id: 1 }, limit: 1 },
    }) as unknown[];
    return pending.length > 0 ? 1 : 0;
  },
  getTriggerJobData: async (payload, reason, { mongo }) => {
    const originalId = (payload as any)?.data?.document?.original_id;
    const existing = await mongo({
      action: "find",
      collection: "diarization_campaigns",
      query: {
        mode: "missing",
        status: { $in: ["counting", "running", "interrupted"] },
        ...(originalId ? { originalId: String(originalId) } : {
          $or: [{ originalId: null }, { originalId: { $exists: false } }],
        }),
      },
      options: { sort: { updatedAt: -1 }, limit: 1 },
    }) as any[];
    const campaign = existing?.[0];
    if (campaign) {
      return {
        type: "diarization",
        mode: "missing",
        campaignId: campaign.campaignId,
        ...(campaign.range?.start ? { start: campaign.range.start } : {}),
        ...(campaign.range?.end ? { end: campaign.range.end } : {}),
        ...(campaign.originalId ? { originalId: campaign.originalId } : {}),
      };
    }
    const now = new Date();
    const oldest = !originalId
      ? (await mongo({
        action: "find",
        collection: "audio_chunks",
        query: {
          "vad.has_speech": true,
          $or: [{ diarized_at: { $exists: false } }, { diarized_at: null }],
        },
        options: { sort: { start: 1 }, limit: 1, projection: { start: 1 } },
      }) as any[])?.[0]
      : null;
    return {
      type: "diarization",
      mode: "missing",
      ...(originalId ? { originalId: String(originalId) } : {}),
      campaignId: `diarization-${
        originalId ? "live" : "historical"
      }-${crypto.randomUUID()}`,
      end: now,
      ...(reason === "speech_missing_diarization"
        ? { start: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
        : oldest?.start
        ? { start: oldest.start }
        : {}),
    };
  },
  triggers: {
    sources: [{
      channel: "mycelia:mongo:audio_chunks",
      name: "speech_missing_diarization",
      filter: {
        event: "mongo.change",
        "data.operationType": "update",
        "data.document.vad.has_speech": true,
        "data.document.diarized_at": { $exists: false },
      },
    }],
    ...getTriggerTiming("diarization"),
  },
});
