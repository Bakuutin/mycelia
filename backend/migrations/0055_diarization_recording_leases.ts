import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const DIARIZATION_RECORDING_LEASE_TTL_INDEX =
  "diarization_recording_leases_expiry_ttl";
export const DIARIZATION_CAMPAIGN_RATE_SAMPLE_INDEX =
  "diarization_campaign_rate_samples_recent";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarization_recording_leases",
    { expiresAt: 1 },
    {
      name: DIARIZATION_RECORDING_LEASE_TTL_INDEX,
      expireAfterSeconds: 0,
    },
  );
  await ensureIndexExists(
    db,
    "diarization_campaign_rate_samples",
    { campaignId: 1, finishedAt: -1 },
    { name: DIARIZATION_CAMPAIGN_RATE_SAMPLE_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  const indexes: Array<[string, string]> = [
    ["diarization_recording_leases", DIARIZATION_RECORDING_LEASE_TTL_INDEX],
    [
      "diarization_campaign_rate_samples",
      DIARIZATION_CAMPAIGN_RATE_SAMPLE_INDEX,
    ],
  ];
  for (const [collection, name] of indexes) {
    if (await db.collection(collection).indexExists(name)) {
      await db.collection(collection).dropIndex(name);
    }
  }
}
