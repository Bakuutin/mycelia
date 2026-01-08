import { Db, MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0009: Adding composite index for audio_chunks transcription fetch...");

  // This index is crucial for backend/app/workers/transcription.ts 
  // which fetches chunks by original_id and index range.
  await ensureIndexExists(
    db,
    "audio_chunks",
    { original_id: 1, index: 1 },
    { name: "original_id_index" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0009: Removing audio_chunks composite index...");
  try {
    await db.collection("audio_chunks").dropIndex("original_id_index");
  } catch (e) {
    // Ignore if not found
  }
}
