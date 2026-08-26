import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";
import { MAP_CELL_ZOOMS } from "@/lib/location/map-spatial.ts";

export const LOCATION_CONVERSATION_PROJECTION =
  "location_conversation_projection";
export const LOCATION_CONVERSATION_PENDING =
  "location_conversation_projection_pending";
export const LOCATION_CONVERSATION_STATE =
  "location_conversation_projection_state";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, LOCATION_CONVERSATION_PROJECTION);
  await ensureCollectionExists(db, LOCATION_CONVERSATION_PENDING);
  await ensureCollectionExists(db, LOCATION_CONVERSATION_STATE);

  await ensureIndexExists(
    db,
    LOCATION_CONVERSATION_PROJECTION,
    { generation: 1, conversationId: 1 },
    { name: "location_conversation_generation_id_v1", unique: true },
  );
  await ensureIndexExists(
    db,
    LOCATION_CONVERSATION_PROJECTION,
    { generation: 1, matched: 1, anchorAt: 1 },
    { name: "location_conversation_generation_time_v1" },
  );
  await ensureIndexExists(
    db,
    LOCATION_CONVERSATION_PROJECTION,
    { generation: 1, groupKey: 1, anchorAt: -1, _id: -1 },
    { name: "location_conversation_group_page_v1" },
  );
  for (const zoom of MAP_CELL_ZOOMS) {
    await ensureIndexExists(
      db,
      LOCATION_CONVERSATION_PROJECTION,
      { generation: 1, matched: 1, [`cellZ${zoom}`]: 1, anchorAt: 1 },
      { name: `location_conversation_cell_z${zoom}_v1` },
    );
  }
  await ensureIndexExists(
    db,
    LOCATION_CONVERSATION_PENDING,
    { queuedAt: 1, _id: 1 },
    { name: "location_conversation_pending_v1" },
  );
  await db.collection<{ _id: string }>(LOCATION_CONVERSATION_STATE).updateOne(
    { _id: "current" },
    {
      $setOnInsert: {
        ready: false,
        building: false,
        stale: false,
        status: "not-built",
        revision: 0,
      },
    },
    { upsert: true },
  );
}

export async function down(_db: Db): Promise<void> {
  // Additive derived-data projection. Keep data intact on rollback.
}
