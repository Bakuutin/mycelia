import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const up = async (db: Db) => {
  await ensureIndexExists(
    db,
    "transcriptions",
    { start: 1 },
    { name: "transcriptions_start_1" },
  );
  await ensureIndexExists(
    db,
    "diarizations",
    { start: 1 },
    { name: "diarizations_start_1" },
  );
  await ensureIndexExists(
    db,
    "jobs",
    {
      "data.timelineRebuildCampaignId": 1,
      "data.timelineRebuildBatchIndex": 1,
    },
    {
      name: "timeline_rebuild_campaign_jobs",
      partialFilterExpression: {
        "data.timelineRebuildCampaignId": { $exists: true },
      },
    },
  );
};

export const down = async (db: Db) => {
  for (
    const [collectionName, indexName] of [
      ["jobs", "timeline_rebuild_campaign_jobs"],
      ["diarizations", "diarizations_start_1"],
      ["transcriptions", "transcriptions_start_1"],
    ] as const
  ) {
    const collection = db.collection(collectionName);
    if (await collection.indexExists(indexName)) {
      await collection.dropIndex(indexName);
    }
  }
};
