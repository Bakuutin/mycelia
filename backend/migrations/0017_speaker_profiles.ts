import { Db } from "mongodb";
import type { MongoClient } from "mongodb";

/**
 * Migration: Create speaker_profiles collection for voice enrollment
 *
 * This migration creates the speaker_profiles collection used to store
 * enrolled speaker voice profiles with their embeddings for speaker identification.
 *
 * Data Safety:
 * - Creates new collection and indexes
 * - Safe to run multiple times (createIndex is idempotent)
 * - down() drops the collection
 */

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Creating speaker_profiles collection...");

  // Create collection if it doesn't exist
  const collections = await db.listCollections({ name: "speaker_profiles" }).toArray();
  if (collections.length === 0) {
    await db.createCollection("speaker_profiles");
    console.log("  + Created speaker_profiles collection");
  } else {
    console.log("  - speaker_profiles collection already exists");
  }

  const speakerProfiles = db.collection("speaker_profiles");

  // Create indexes
  // Unique index on name (only one profile per name)
  await speakerProfiles.createIndex(
    { name: 1 },
    { unique: true, name: "name_unique" }
  );
  console.log("  + Created unique index on name");

  // Index for primary profile lookup
  await speakerProfiles.createIndex(
    { is_primary: 1 },
    { name: "is_primary_idx", sparse: true }
  );
  console.log("  + Created index on is_primary");

  // Index for sorting by creation date
  await speakerProfiles.createIndex(
    { created_at: -1 },
    { name: "created_at_desc" }
  );
  console.log("  + Created index on created_at");

  console.log("✓ speaker_profiles collection ready");
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Dropping speaker_profiles collection...");
  await db.collection("speaker_profiles").drop().catch(() => {
    console.log("  - Collection doesn't exist, nothing to drop");
  });
  console.log("✓ speaker_profiles collection dropped");
}
