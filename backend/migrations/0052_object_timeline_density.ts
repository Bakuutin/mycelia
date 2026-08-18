import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";
import {
  OBJECT_TIMELINE_DENSITY_COLLECTION,
  OBJECT_TIMELINE_DENSITY_INDEX,
  OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
  OBJECT_TIMELINE_DENSITY_PENDING_INDEX,
  OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION,
  OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
} from "@/lib/objects/timeline-density.ts";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, OBJECT_TIMELINE_DENSITY_COLLECTION);
  await ensureIndexExists(
    db,
    OBJECT_TIMELINE_DENSITY_COLLECTION,
    { resolution: 1, start: 1 },
    { name: OBJECT_TIMELINE_DENSITY_INDEX, unique: true },
  );
  await ensureCollectionExists(db, OBJECT_TIMELINE_DENSITY_SOURCE_COLLECTION);
  await ensureCollectionExists(db, OBJECT_TIMELINE_DENSITY_STATE_COLLECTION);
  await ensureCollectionExists(db, OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION);
  await ensureIndexExists(
    db,
    OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    { queuedAt: 1, _id: 1 },
    { name: OBJECT_TIMELINE_DENSITY_PENDING_INDEX },
  );
  await db.collection<{ _id: string }>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).updateOne(
    { _id: "current" },
    {
      $setOnInsert: {
        ready: false,
        building: false,
        dirty: true,
        repairStatus: "not-built",
        hasFullRebuild: false,
        changeSequence: 0,
        processedSequence: 0,
        pendingWrites: [],
      },
    },
    { upsert: true },
  );
}

export async function down(db: Db): Promise<void> {
  const density = db.collection(OBJECT_TIMELINE_DENSITY_COLLECTION);
  if (await density.indexExists(OBJECT_TIMELINE_DENSITY_INDEX)) {
    await density.dropIndex(OBJECT_TIMELINE_DENSITY_INDEX);
  }
  const pending = db.collection(OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION);
  if (await pending.indexExists(OBJECT_TIMELINE_DENSITY_PENDING_INDEX)) {
    await pending.dropIndex(OBJECT_TIMELINE_DENSITY_PENDING_INDEX);
  }
}
