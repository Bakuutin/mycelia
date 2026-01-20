import { Db, MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0010: Adding chunk_id tracking for streaming chunk creation...");

  // Index for finding unassigned transcriptions efficiently
  // Used by conversation_chunk_creator to find transcriptions that need to be assigned to chunks
  // Using sparse index so only documents with chunk_id are indexed (queries for missing chunk_id
  // will use collection scan, but that's fine for the initial backfill scenario)
  await ensureIndexExists(
    db,
    "transcriptions",
    { chunk_id: 1, createdAt: -1 },
    { name: "chunk_id_created_at" },
  );

  // Index for conversation_chunks by state and lastActivityAt
  // Used to find stale "open" chunks that need to be finalized
  await ensureIndexExists(
    db,
    "conversation_chunks",
    { state: 1, lastActivityAt: 1 },
    { name: "state_last_activity" },
  );

  // Index for finding open chunks by original_id
  // Used to find the active open chunk for a recording session
  await ensureIndexExists(
    db,
    "conversation_chunks",
    { original_id: 1, state: 1 },
    { name: "original_id_state" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0010: Removing chunk tracking indexes...");
  
  try {
    await db.collection("transcriptions").dropIndex("chunk_id_created_at");
  } catch (e) {
    // Ignore if not found
  }
  
  try {
    await db.collection("conversation_chunks").dropIndex("state_last_activity");
  } catch (e) {
    // Ignore if not found
  }
  
  try {
    await db.collection("conversation_chunks").dropIndex("original_id_state");
  } catch (e) {
    // Ignore if not found
  }
}
