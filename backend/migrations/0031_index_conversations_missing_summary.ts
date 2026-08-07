import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

// The summarization candidate lookup (worker batch selection, pipeline status
// counts, hasPendingWork trigger gate) filters conversations without summaries
// and sorts by updatedAt. Without an index that is a COLLSCAN over the whole
// objects collection (~200k documents, ~250ms) plus an in-memory sort, run on
// every trigger tick.
//
// The predicate uses "summaries.0.date" instead of "summaries.0" on purpose:
// every summary entry always carries `date`, and a date is a tiny index key
// while the first summary itself averages ~6KB. Missing fields index as null,
// so `$exists: false` scans only the [null, null] bounds — conversations that
// still need a summary — and skips summarized ones entirely. The partial
// filter keeps non-conversation objects out of the index.
export async function up(db: Db, _client: MongoClient): Promise<void> {
  await ensureIndexExists(
    db,
    "objects",
    { isConversation: 1, "summaries.0.date": 1, updatedAt: -1 },
    {
      name: "conversation_missing_summary",
      partialFilterExpression: { isConversation: true },
    },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  try {
    await db.collection("objects").dropIndex("conversation_missing_summary");
    console.log("Dropped index conversation_missing_summary on objects");
  } catch {
    console.log("No index conversation_missing_summary on objects to drop");
  }
}
