import { Db, MongoClient } from "mongodb";
import { ensureCollectionExists, ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0007: Adding transcription_sequences collection and indexes...");

  await ensureCollectionExists(db, "transcription_sequences");

  await ensureIndexExists(
    db,
    "transcription_sequences",
    { original_id: 1, state: 1, start: 1 },
    { name: "original_id_state_start" },
  );

  await ensureIndexExists(
    db,
    "transcription_sequences",
    { state: 1, createdAt: 1 },
    { name: "state_created_at" },
  );

  // Index for finding the latest sequence for an original_id to append to
  await ensureIndexExists(
    db,
    "transcription_sequences",
    { original_id: 1, start: -1 },
    { name: "original_id_latest" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0007: Removing transcription_sequences collection...");
  await db.dropCollection("transcription_sequences");
}

