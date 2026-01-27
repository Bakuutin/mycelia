import { Db, ObjectId } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, client: MongoClient): Promise<void> {
  console.log("Creating workers collection...");
  
  // Create the workers collection
  const collections = await db.listCollections({ name: "workers" }).toArray();
  if (collections.length === 0) {
    await db.createCollection("workers");
    console.log("Created workers collection");
  }
  
  // Create unique index on worker name
  await ensureIndexExists(
    db,
    "workers",
    { name: 1 },
    { name: "worker_name_unique", unique: true },
  );
  
  // Create index on discovered status
  await ensureIndexExists(
    db,
    "workers",
    { discovered: 1, lastSeen: -1 },
    { name: "worker_discovered_lastseen" },
  );

  console.log("Successfully created workers collection and indexes");
}

export async function down(db: Db, client: MongoClient): Promise<void> {
  console.log("Removing workers collection...");
  
  try {
    await db.collection("workers").drop();
    console.log("Dropped workers collection");
  } catch (error) {
    console.log("No workers collection to drop");
  }
}
