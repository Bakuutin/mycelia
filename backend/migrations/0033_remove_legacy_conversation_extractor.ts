import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ObjectId } from "mongodb";

const CONFIG_ID = new ObjectId("000000000000000000000000");

/**
 * The legacy two-call conversation_extractor worker is deleted from the
 * codebase (conversation_extractor_merged is the only extractor). Clean up
 * the runtime leftovers:
 * - the paused flag written by migration 0029 (nothing reads it anymore);
 * - queued jobs of the removed type — no BullMQ worker will ever consume
 *   them, so without this they would sit in "waiting" forever.
 * Historical completed/failed jobs are intentionally kept: the jobs list
 * exposes them through a legacy-type allowlist.
 */
export async function up(db: Db, _client: MongoClient): Promise<void> {
  await db.collection("configs").updateOne(
    { _id: CONFIG_ID as any },
    { $unset: { "workers.conversation_extractor": "" } },
  );

  const now = new Date();
  const cancelled = await db.collection("jobs").updateMany(
    {
      type: "conversation_extractor",
      state: { $in: ["waiting", "delayed", "active"] },
    },
    {
      $set: {
        state: "cancelled",
        cancelReason: "worker_removed",
        failedReason: "conversation_extractor worker was removed",
        finishedAt: now,
        updatedAt: now,
      },
    },
  );
  console.log(
    `Cancelled ${cancelled.modifiedCount} stranded conversation_extractor job(s)`,
  );
}

export async function down(_db: Db, _client: MongoClient): Promise<void> {
  // The worker no longer exists in the codebase; there is nothing meaningful
  // to restore. Cancelled queue entries stay cancelled.
}
