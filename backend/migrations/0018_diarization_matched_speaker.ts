import { Db } from "mongodb";
import type { MongoClient } from "mongodb";

/**
 * Migration: Add matched_speaker field index to diarizations collection
 *
 * This migration adds a sparse index on the matched_speaker.profile_id field
 * to efficiently query diarization segments by identified speaker.
 *
 * Data Safety:
 * - Only creates index (no data modification)
 * - Sparse index means documents without matched_speaker are not indexed
 * - Safe to run multiple times (createIndex is idempotent)
 * - down() drops only the index
 */

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Adding matched_speaker indexes to diarizations collection...");

  const diarizations = db.collection("diarizations");

  // Sparse index on matched_speaker.profile_id for efficient lookups
  // Sparse means documents without matched_speaker won't be in the index
  await diarizations.createIndex(
    { "matched_speaker.profile_id": 1 },
    { 
      name: "matched_speaker_profile_id_sparse",
      sparse: true 
    }
  );
  console.log("  + Created sparse index on matched_speaker.profile_id");

  // Compound index for filtering by speaker and time range
  await diarizations.createIndex(
    { "matched_speaker.profile_id": 1, start: 1 },
    { 
      name: "matched_speaker_profile_id_start",
      sparse: true 
    }
  );
  console.log("  + Created compound index on matched_speaker.profile_id + start");

  // Index for finding unmatched diarizations (for retroactive matching)
  // This uses a partial filter expression to only index documents where matched_speaker doesn't exist
  await diarizations.createIndex(
    { start: 1 },
    { 
      name: "start_unmatched",
      partialFilterExpression: { matched_speaker: { $exists: false } }
    }
  );
  console.log("  + Created partial index for unmatched diarizations");

  console.log("✓ diarizations matched_speaker indexes ready");
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Dropping matched_speaker indexes from diarizations collection...");

  const diarizations = db.collection("diarizations");

  await diarizations.dropIndex("matched_speaker_profile_id_sparse").catch(() => {
    console.log("  - Index matched_speaker_profile_id_sparse doesn't exist");
  });
  await diarizations.dropIndex("matched_speaker_profile_id_start").catch(() => {
    console.log("  - Index matched_speaker_profile_id_start doesn't exist");
  });
  await diarizations.dropIndex("start_unmatched").catch(() => {
    console.log("  - Index start_unmatched doesn't exist");
  });

  console.log("✓ matched_speaker indexes dropped");
}
