import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ObjectId } from "mongodb";

const CONFIG_ID = new ObjectId("000000000000000000000000");

// The experimental merged extractor (one LLM call per chunk) ships disabled:
// when enabled it competes with the regular conversation_extractor for ready
// chunks. The On checkbox on the Jobs page is the opt-in toggle.
export async function up(db: Db, _client: MongoClient): Promise<void> {
  await db.collection("configs").updateOne(
    { _id: CONFIG_ID as any },
    {
      $set: { "workers.conversation_extractor_merged.paused": true },
    },
    { upsert: true },
  );
  console.log("conversation_extractor_merged paused by default");
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  await db.collection("configs").updateOne(
    { _id: CONFIG_ID as any },
    { $unset: { "workers.conversation_extractor_merged": "" } },
  );
}
