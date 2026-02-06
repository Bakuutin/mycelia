import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureCollectionExists } from "@/utils/migrations.ts";

/**
 * Migration: Create marked_ranges collection
 *
 * Stores timeline bookmarks/favorites with color and label.
 *
 * Data Safety:
 * - Creates collection and indexes only (no data modification)
 * - Safe to run multiple times (idempotent)
 * - down() drops the collection
 */

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Creating marked_ranges collection...");

  await ensureCollectionExists(db, "marked_ranges");

  const col = db.collection("marked_ranges");

  await col.createIndex(
    { start: 1, end: 1 },
    { name: "start_end" }
  );

  await col.createIndex(
    { createdAt: -1 },
    { name: "createdAt_desc" }
  );

  console.log("✓ marked_ranges collection ready");
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Dropping marked_ranges collection...");
  await db.dropCollection("marked_ranges").catch(() => {
    console.log("  - Collection marked_ranges doesn't exist");
  });
  console.log("✓ marked_ranges collection dropped");
}
