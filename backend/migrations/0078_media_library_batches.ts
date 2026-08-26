import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const COLLECTIONS = [
  "media_folder_campaigns",
  "media_folder_items",
  "media_recognition_batch_previews",
  "media_recognition_batches",
  "media_recognition_batch_items",
  "media_asset_placement_history",
] as const;

export async function up(db: Db): Promise<void> {
  for (const collection of COLLECTIONS) {
    await ensureCollectionExists(db, collection);
  }

  await ensureIndexExists(
    db,
    "media_folder_campaigns",
    { owner: 1, createdAt: -1 },
    { name: "media_folder_campaign_owner_created_v1" },
  );
  await ensureIndexExists(
    db,
    "media_folder_campaigns",
    { status: 1, updatedAt: 1 },
    { name: "media_folder_campaign_pending_v1" },
  );
  await ensureIndexExists(
    db,
    "media_folder_items",
    { campaignId: 1, relativePath: 1 },
    { name: "media_folder_item_campaign_path_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "media_folder_items",
    { campaignId: 1, state: 1, _id: 1 },
    { name: "media_folder_item_campaign_state_v1" },
  );
  await ensureIndexExists(
    db,
    "media_recognition_batch_previews",
    { expiresAt: 1 },
    {
      name: "media_recognition_batch_preview_ttl_v1",
      expireAfterSeconds: 0,
    },
  );
  await ensureIndexExists(
    db,
    "media_recognition_batches",
    { owner: 1, previewId: 1 },
    { name: "media_recognition_batch_preview_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "media_recognition_batches",
    { owner: 1, createdAt: -1 },
    { name: "media_recognition_batch_owner_created_v1" },
  );
  await ensureIndexExists(
    db,
    "media_recognition_batches",
    { status: 1, updatedAt: 1 },
    { name: "media_recognition_batch_pending_v1" },
  );
  await ensureIndexExists(
    db,
    "media_recognition_batch_items",
    { batchId: 1, assetId: 1 },
    { name: "media_recognition_batch_asset_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    "media_recognition_batch_items",
    { batchId: 1, state: 1, _id: 1 },
    { name: "media_recognition_batch_state_v1" },
  );
  await ensureIndexExists(
    db,
    "media_asset_placement_history",
    { owner: 1, assetId: 1, createdAt: -1 },
    { name: "media_asset_placement_history_v1" },
  );
  await ensureIndexExists(
    db,
    "media_assets",
    { owner: 1, geo: "2dsphere" },
    {
      name: "media_asset_geo_v1",
      partialFilterExpression: { "geo.type": "Point" },
    },
  );

  await db.collection("media_assets").updateMany(
    {
      geo: { $exists: false },
      "location.latitude": { $type: "number" },
      "location.longitude": { $type: "number" },
    },
    [
      {
        $set: {
          geo: {
            type: "Point",
            coordinates: ["$location.longitude", "$location.latitude"],
          },
          locationSource: { $ifNull: ["$locationSource", "exif"] },
          placementRevision: { $ifNull: ["$placementRevision", 0] },
        },
      },
    ],
  );
  await db.collection("media_assets").updateMany(
    { placementRevision: { $exists: false } },
    { $set: { placementRevision: 0 } },
  );
}

export async function down(db: Db): Promise<void> {
  // Campaign audit records and canonical assets survive rollback. Only indexes
  // introduced by this migration are removed.
  const indexes: Array<[string, string]> = [
    ["media_folder_campaigns", "media_folder_campaign_owner_created_v1"],
    ["media_folder_campaigns", "media_folder_campaign_pending_v1"],
    ["media_folder_items", "media_folder_item_campaign_path_v1"],
    ["media_folder_items", "media_folder_item_campaign_state_v1"],
    [
      "media_recognition_batch_previews",
      "media_recognition_batch_preview_ttl_v1",
    ],
    [
      "media_recognition_batches",
      "media_recognition_batch_owner_created_v1",
    ],
    ["media_recognition_batches", "media_recognition_batch_preview_v1"],
    ["media_recognition_batches", "media_recognition_batch_pending_v1"],
    ["media_recognition_batch_items", "media_recognition_batch_asset_v1"],
    ["media_recognition_batch_items", "media_recognition_batch_state_v1"],
    ["media_asset_placement_history", "media_asset_placement_history_v1"],
    ["media_assets", "media_asset_geo_v1"],
  ];
  for (const [collection, name] of indexes) {
    if (await db.collection(collection).indexExists(name)) {
      await db.collection(collection).dropIndex(name);
    }
  }
}
