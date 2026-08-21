import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const COLLECTIONS = [
  "jobs_dashboard_snapshots",
  "job_run_history_daily",
  "timeline_rebuild_campaigns",
] as const;

export async function up(db: Db): Promise<void> {
  for (const collection of COLLECTIONS) {
    await ensureCollectionExists(db, collection);
  }
  await ensureIndexExists(
    db,
    "jobs",
    { updatedAt: 1, _id: 1 },
    { name: "jobs_dashboard_updated_cursor_v1" },
  );
  await ensureIndexExists(
    db,
    "jobs",
    { state: 1, finishedAt: 1, type: 1 },
    { name: "jobs_state_finished_type_v1" },
  );
  await ensureIndexExists(
    db,
    "job_run_history_daily",
    { dayUTC: 1, type: 1 },
    { name: "job_history_day_type_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "job_run_history_daily",
    { type: 1, dayUTC: -1 },
    { name: "job_history_type_day_v1" },
  );
  await ensureIndexExists(
    db,
    "jobs",
    {
      "data.timelineRebuildCampaignId": 1,
      "data.timelineRebuildBatchIndex": 1,
    },
    {
      name: "timeline_rebuild_campaign_batch_unique_v1",
      unique: true,
      partialFilterExpression: {
        "data.timelineRebuildCampaignId": { $exists: true },
        "data.timelineRebuildBatchIndex": { $exists: true },
      },
    },
  );
  await ensureIndexExists(
    db,
    "objects",
    { _entityTypingPending: 1 },
    {
      name: "objects_entity_typing_pending_v1",
      partialFilterExpression: { _entityTypingPending: true },
    },
  );

  await db.collection<{ _id: string; [key: string]: unknown }>(
    "object_list_state",
  ).updateOne(
    { _id: "catalog" },
    {
      $set: {
        schemaVersion: 2,
        ready: false,
        entityTypingReady: false,
        lastBackfilledId: null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const [collection, index] of [
      ["objects", "objects_entity_typing_pending_v1"],
      ["jobs", "timeline_rebuild_campaign_batch_unique_v1"],
      ["job_run_history_daily", "job_history_type_day_v1"],
      ["job_run_history_daily", "job_history_day_type_v1"],
      ["jobs", "jobs_state_finished_type_v1"],
      ["jobs", "jobs_dashboard_updated_cursor_v1"],
    ] as const
  ) {
    if (await db.collection(collection).indexExists(index)) {
      await db.collection(collection).dropIndex(index);
    }
  }
  for (const collection of [...COLLECTIONS].reverse()) {
    await db.collection(collection).drop().catch(() => undefined);
  }
}
