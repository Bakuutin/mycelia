import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const CAMPAIGNS = "speaker_identity_campaigns";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, CAMPAIGNS);
  await ensureIndexExists(
    db,
    CAMPAIGNS,
    { campaignId: 1 },
    { name: "speaker_identity_campaign_id", unique: true },
  );
  await ensureIndexExists(
    db,
    CAMPAIGNS,
    { profileId: 1, status: 1, updatedAt: -1 },
    { name: "speaker_identity_campaign_profile_status" },
  );
  await ensureIndexExists(
    db,
    "diarizations",
    { runId: 1, lifecycleStatus: 1, start: 1, _id: 1 },
    { name: "speaker_identity_campaign_scan" },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const [collection, name] of [
      ["diarizations", "speaker_identity_campaign_scan"],
      [CAMPAIGNS, "speaker_identity_campaign_profile_status"],
      [CAMPAIGNS, "speaker_identity_campaign_id"],
    ] as const
  ) {
    if (await db.collection(collection).indexExists(name)) {
      await db.collection(collection).dropIndex(name);
    }
  }
}
