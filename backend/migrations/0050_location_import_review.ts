import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const PREVIEWS = "location_import_previews";
const TRACKS = "location_tracks";
const BOOKMARKS = "location_bookmarks";
const CONFLICTS = "location_point_conflicts";
const POINTS = "location_points";
const IMPORTS = "location_imports";

const INDEXES: Array<{
  collection: string;
  keys: Record<string, 1 | -1 | "2dsphere">;
  name: string;
  options?: Record<string, unknown>;
}> = [
  {
    collection: PREVIEWS,
    keys: { expiresAt: 1 },
    name: "location_preview_expiry_v1",
  },
  {
    collection: PREVIEWS,
    keys: { contentHash: 1, status: 1 },
    name: "location_preview_content_status_v1",
  },
  {
    collection: TRACKS,
    keys: { fingerprint: 1 },
    name: "location_track_fingerprint_v1",
    options: { unique: true },
  },
  {
    collection: TRACKS,
    keys: { "sourceRefs.importId": 1 },
    name: "location_track_imports_v1",
  },
  {
    collection: BOOKMARKS,
    keys: { loc: "2dsphere" },
    name: "location_bookmark_loc_v1",
  },
  {
    collection: BOOKMARKS,
    keys: { coordinateHash: 1 },
    name: "location_bookmark_coordinate_v1",
  },
  {
    collection: BOOKMARKS,
    keys: { "sourceRefs.importId": 1 },
    name: "location_bookmark_imports_v1",
  },
  {
    collection: CONFLICTS,
    keys: { conflictKey: 1 },
    name: "location_point_conflict_key_v1",
    options: { unique: true },
  },
  {
    collection: CONFLICTS,
    keys: { status: 1, ts: 1 },
    name: "location_point_conflict_review_v1",
  },
  {
    collection: POINTS,
    keys: { importIds: 1 },
    name: "location_point_imports_v1",
  },
  {
    collection: POINTS,
    keys: { visible: 1, selection: 1, ts: 1, _id: 1 },
    name: "location_point_canonical_cursor_v1",
  },
  {
    collection: IMPORTS,
    keys: { status: 1, committedAt: 1, createdAt: 1 },
    name: "location_import_lifecycle_v1",
  },
];

export async function up(db: Db): Promise<void> {
  for (const collection of [PREVIEWS, TRACKS, BOOKMARKS, CONFLICTS]) {
    await ensureCollectionExists(db, collection);
  }

  const validImportIds = await db.collection(IMPORTS).distinct("_id");
  if (validImportIds.length > 0) {
    await db.collection(POINTS).updateMany(
      { importId: { $in: validImportIds } },
      [
        {
          $set: {
            importIds: {
              $cond: [
                { $gt: [{ $size: { $ifNull: ["$importIds", []] } }, 0] },
                "$importIds",
                ["$importId"],
              ],
            },
            selection: { $ifNull: ["$selection", "accepted"] },
            visible: { $ifNull: ["$visible", true] },
          },
        },
      ],
    );
  }

  // A point whose owner import was never committed is a failed-import
  // artifact. Preserve it for explicit recovery, but immediately exclude it
  // from canonical readers and workers.
  await db.collection(POINTS).updateMany(
    {
      $or: [
        { importId: { $exists: false } },
        { importId: { $nin: validImportIds } },
      ],
    },
    [{
      $set: {
        visible: false,
        selection: "accepted",
        recoveryState: "orphaned",
        importIds: { $ifNull: ["$importIds", []] },
      },
    }],
  );

  // Legacy imports were fully written before their import document appeared;
  // treat those durable records as committed for the new visibility contract.
  await db.collection(IMPORTS).updateMany(
    {
      status: { $in: ["parsed", "processed"] },
      committedAt: { $exists: false },
    },
    [{ $set: { committedAt: { $ifNull: ["$updatedAt", "$createdAt"] } } }],
  );

  for (const index of INDEXES) {
    await ensureIndexExists(
      db,
      index.collection,
      index.keys,
      { name: index.name, ...(index.options ?? {}) },
    );
  }
}

export async function down(db: Db): Promise<void> {
  for (const index of [...INDEXES].reverse()) {
    const collection = db.collection(index.collection);
    if (await collection.indexExists(index.name)) {
      await collection.dropIndex(index.name);
    }
  }
}
