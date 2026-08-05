import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

// get_worker_status counts stale summarization claims on every poll (every 10s
// from the Jobs page). Without an index that count scanned the whole objects
// collection — 126k documents examined to return ~100, ~600ms per call. Only a
// handful of objects carry a claim at any time, so a sparse index stays small.
export async function up(db: Db, _client: MongoClient): Promise<void> {
  await ensureIndexExists(
    db,
    "objects",
    { "_summarizationClaim.startedAt": 1 },
    { name: "summarizationClaim_startedAt_1", sparse: true },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  try {
    await db.collection("objects").dropIndex("summarizationClaim_startedAt_1");
    console.log("Dropped index summarizationClaim_startedAt_1 on objects");
  } catch {
    console.log("No index summarizationClaim_startedAt_1 on objects to drop");
  }
}
