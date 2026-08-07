import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ObjectId } from "mongodb";

const CONFIG_ID = new ObjectId("000000000000000000000000");

/**
 * 1. Repair poisoned conversation_chunks: chunks created while a task
 *    override pointed at an explicit selfhost model snapshot a model name
 *    (e.g. "Qwen…gguf") that can never fail over — every retry is a
 *    guaranteed 400 on other routes. Reset them to the "small" alias, which
 *    resolves per provider, and clear the retry backoff so extraction picks
 *    them up immediately.
 *
 * 2. Promote the merged single-call extractor to primary: it replaces both
 *    LLM calls of the legacy conversation_extractor (and tagging for new
 *    conversations). The legacy worker stays available for rollback but is
 *    paused; both claim the same chunks, so only one may run.
 */
export async function up(db: Db, _client: MongoClient): Promise<void> {
  const repaired = await db.collection("conversation_chunks").updateMany(
    {
      state: { $in: ["ready", "error", "processing"] },
      "params.model": /\.gguf$/i,
    },
    {
      $set: { "params.model": "small" },
      $unset: { extractionRetryAfter: "", extractionRetryCount: "" },
    },
  );
  console.log(
    `Repaired ${repaired.modifiedCount} chunk(s) with unroutable explicit models`,
  );

  await db.collection("configs").updateOne(
    { _id: CONFIG_ID as any },
    {
      $set: {
        "workers.conversation_extractor.paused": true,
        "workers.conversation_extractor_merged.paused": false,
      },
    },
    { upsert: true },
  );
  console.log(
    "conversation_extractor_merged promoted to primary; legacy conversation_extractor paused",
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  // Chunk model names are unrecoverable; only the promotion is reverted.
  await db.collection("configs").updateOne(
    { _id: CONFIG_ID as any },
    {
      $set: {
        "workers.conversation_extractor.paused": false,
        "workers.conversation_extractor_merged.paused": true,
      },
    },
  );
}
