import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const CAMPAIGNS = "diarization_campaigns";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, CAMPAIGNS);
  await ensureIndexExists(db, CAMPAIGNS, { campaignId: 1 }, {
    name: "diarization_campaign_id",
    unique: true,
  });
  await ensureIndexExists(db, CAMPAIGNS, { status: 1, updatedAt: -1 }, {
    name: "diarization_campaign_status_updated",
  });
  await ensureIndexExists(db, "diarizations", { runId: 1, segmentKey: 1 }, {
    name: "diarization_run_segment_key",
    unique: true,
    partialFilterExpression: { segmentKey: { $exists: true } },
  });
  await ensureIndexExists(
    db,
    "audio_chunks",
    { "diarizationFailure.status": 1, "diarizationFailure.retryAt": 1 },
    { name: "audio_chunk_diarization_retry" },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const [collection, index] of [
      [CAMPAIGNS, "diarization_campaign_id"],
      [CAMPAIGNS, "diarization_campaign_status_updated"],
      ["diarizations", "diarization_run_segment_key"],
      ["audio_chunks", "audio_chunk_diarization_retry"],
    ] as const
  ) {
    if (await db.collection(collection).indexExists(index)) {
      await db.collection(collection).dropIndex(index);
    }
  }
}
