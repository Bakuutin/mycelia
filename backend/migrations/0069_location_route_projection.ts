import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

export const LOCATION_ROUTE_FRAGMENTS = "location_route_fragments";
export const LOCATION_ROUTE_GEOMETRY = "location_route_geometry";
export const LOCATION_ROUTE_BREAKS = "location_route_breaks";
export const LOCATION_ROUTE_CONFLICTS = "location_route_conflicts";
export const LOCATION_ROUTE_STATE = "location_route_projection_state";

export async function up(db: Db): Promise<void> {
  for (
    const name of [
      LOCATION_ROUTE_FRAGMENTS,
      LOCATION_ROUTE_GEOMETRY,
      LOCATION_ROUTE_BREAKS,
      LOCATION_ROUTE_CONFLICTS,
      LOCATION_ROUTE_STATE,
    ]
  ) await ensureCollectionExists(db, name);

  await db.collection("location_tracks").updateMany(
    { routeBoundaryCompleteness: { $exists: false } },
    { $set: { routeBoundaryCompleteness: "unknown" } },
  );

  await ensureIndexExists(
    db,
    LOCATION_ROUTE_FRAGMENTS,
    { generation: 1, trackId: 1, fragmentIndex: 1 },
    { name: "location_route_fragment_identity_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    LOCATION_ROUTE_FRAGMENTS,
    { generation: 1, timeStart: 1, timeEnd: 1 },
    { name: "location_route_fragment_time_v1" },
  );
  await ensureIndexExists(
    db,
    LOCATION_ROUTE_FRAGMENTS,
    { bounds: "2dsphere" },
    { name: "location_route_fragment_bounds_v1" },
  );
  await ensureIndexExists(
    db,
    LOCATION_ROUTE_GEOMETRY,
    { generation: 1, trackId: 1, fragmentIndex: 1, chunkIndex: 1 },
    { name: "location_route_geometry_order_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    LOCATION_ROUTE_BREAKS,
    { generation: 1, trackId: 1, breakIndex: 1 },
    { name: "location_route_break_identity_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    LOCATION_ROUTE_CONFLICTS,
    { pairKey: 1 },
    { name: "location_route_conflict_pair_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    LOCATION_ROUTE_CONFLICTS,
    { status: 1, overlapStart: 1 },
    { name: "location_route_conflict_review_v1" },
  );
  await db.collection<{ _id: string }>(LOCATION_ROUTE_STATE).updateOne(
    { _id: "current" },
    {
      $setOnInsert: {
        ready: false,
        building: false,
        dirty: false,
        status: "not-built",
        revision: 0,
        projectionVersion: 1,
        boundarySchemaVersion: 3,
      },
    },
    { upsert: true },
  );
}

export async function down(_db: Db): Promise<void> {
  // Additive derived-data projection. Keep data intact on rollback.
}
