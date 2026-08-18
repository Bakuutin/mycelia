import type { Db, IndexSpecification } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const GEOMETRY = "location_track_geometry";
const METADATA_CONFLICTS = "location_metadata_conflicts";
const TRACKS = "location_tracks";
const IMPORTS = "location_imports";

const INDEXES: Array<{
  collection: string;
  keys: IndexSpecification;
  name: string;
  options: Record<string, unknown>;
}> = [
  {
    collection: GEOMETRY,
    keys: { trackId: 1, chunkIndex: 1 } as const,
    name: "location_track_geometry_chunk_v1",
    options: { unique: true },
  },
  {
    collection: GEOMETRY,
    keys: { trackId: 1, startIndex: 1 } as const,
    name: "location_track_geometry_order_v1",
    options: {},
  },
  {
    collection: METADATA_CONFLICTS,
    keys: { conflictKey: 1 } as const,
    name: "location_metadata_conflict_key_v1",
    options: { unique: true },
  },
  {
    collection: METADATA_CONFLICTS,
    keys: { status: 1, entityType: 1, createdAt: -1 } as const,
    name: "location_metadata_conflict_review_v1",
    options: {},
  },
  {
    collection: TRACKS,
    keys: { geometryCompleteness: 1, updatedAt: -1 } as const,
    name: "location_track_geometry_completeness_v1",
    options: {},
  },
  {
    collection: IMPORTS,
    keys: { contentProfileVersion: 1, committedAt: -1 } as const,
    name: "location_import_content_profile_v1",
    options: {},
  },
];

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, GEOMETRY);
  await ensureCollectionExists(db, METADATA_CONFLICTS);

  // Existing `path` values were intentionally reduced for rendering. Keep
  // them as a compatibility fallback, but never claim they are full source
  // geometry until the original GridFS file has been reparsed.
  await db.collection(TRACKS).updateMany(
    { renderPath: { $exists: false }, path: { $exists: true } },
    [{
      $set: {
        renderPath: "$path",
        geometryPointCount: { $ifNull: ["$pointCount", 0] },
        geometryCompleteness: "render-only",
        contentProfileVersion: 1,
      },
    }],
  );
  await db.collection(IMPORTS).updateMany(
    { contentProfileVersion: { $exists: false } },
    { $set: { contentProfileVersion: 1 } },
  );

  for (const index of INDEXES) {
    await ensureIndexExists(
      db,
      index.collection,
      index.keys,
      { name: index.name, ...index.options },
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
