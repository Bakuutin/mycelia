import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";
import {
  OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
  OBJECT_TIMELINE_DENSITY_PENDING_INDEX,
  OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
} from "@/lib/objects/timeline-density.ts";

type DensityStateDocument = {
  _id: string;
  [key: string]: unknown;
};

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION);
  await ensureIndexExists(
    db,
    OBJECT_TIMELINE_DENSITY_PENDING_COLLECTION,
    { queuedAt: 1, _id: 1 },
    { name: OBJECT_TIMELINE_DENSITY_PENDING_INDEX },
  );
  await ensureCollectionExists(db, OBJECT_TIMELINE_DENSITY_STATE_COLLECTION);

  // Some installations recorded 0052 before the durable queue/state fields
  // were added to that migration. Fill only missing fields: a completed density
  // projection and its calculatedAt/source counters remain authoritative.
  await db.collection<DensityStateDocument>(
    OBJECT_TIMELINE_DENSITY_STATE_COLLECTION,
  ).updateOne(
    { _id: "current" },
    [{
      $set: {
        ready: {
          $cond: [
            { $eq: [{ $type: "$ready" }, "missing"] },
            false,
            "$ready",
          ],
        },
        building: {
          $cond: [
            { $eq: [{ $type: "$building" }, "missing"] },
            false,
            "$building",
          ],
        },
        dirty: {
          $cond: [
            { $eq: [{ $type: "$dirty" }, "missing"] },
            { $ne: ["$ready", true] },
            "$dirty",
          ],
        },
        repairStatus: {
          $cond: [
            { $eq: [{ $type: "$repairStatus" }, "missing"] },
            { $cond: [{ $eq: ["$ready", true] }, "ready", "not-built"] },
            "$repairStatus",
          ],
        },
        hasFullRebuild: {
          $cond: [
            { $eq: [{ $type: "$hasFullRebuild" }, "missing"] },
            { $eq: ["$ready", true] },
            "$hasFullRebuild",
          ],
        },
        changeSequence: {
          $cond: [
            { $eq: [{ $type: "$changeSequence" }, "missing"] },
            0,
            "$changeSequence",
          ],
        },
        processedSequence: {
          $cond: [
            { $eq: [{ $type: "$processedSequence" }, "missing"] },
            {
              $cond: [
                { $eq: ["$ready", true] },
                { $ifNull: ["$changeSequence", 0] },
                0,
              ],
            },
            "$processedSequence",
          ],
        },
        pendingWrites: {
          $cond: [
            { $eq: [{ $type: "$pendingWrites" }, "missing"] },
            [],
            "$pendingWrites",
          ],
        },
      },
    }],
    { upsert: true },
  );
}

export async function down(_db: Db): Promise<void> {
  // Additive repair only. Removing a queue/index that may predate this
  // migration would make the still-installed density worker unsafe.
}
