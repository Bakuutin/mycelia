import { Db, type MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  await ensureIndexExists(
    db,
    "audio_chunks",
    { claimed_at: 1 },
    {
      name: "audio_chunks_claimed_at_active",
      partialFilterExpression: { claimed_at: { $type: "date" } },
    },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  try {
    await db.collection("audio_chunks").dropIndex(
      "audio_chunks_claimed_at_active",
    );
  } catch {
    // Idempotent rollback.
  }
}
