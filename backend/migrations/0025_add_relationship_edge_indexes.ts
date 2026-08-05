import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

// Relationship edges are queried by both endpoints (getRelationships, orphan
// detection) and rewritten in bulk by object merge/split. messages.senderId is
// rewritten when two person objects are merged.
export async function up(db: Db, _client: MongoClient): Promise<void> {
  await ensureIndexExists(
    db,
    "objects",
    { "relationship.subject": 1 },
    { name: "relationship_subject_1", sparse: true },
  );
  await ensureIndexExists(
    db,
    "objects",
    { "relationship.object": 1 },
    { name: "relationship_object_1", sparse: true },
  );
  await ensureIndexExists(
    db,
    "messages",
    { senderId: 1 },
    { name: "senderId_1" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  const targets: Array<[string, string]> = [
    ["objects", "relationship_subject_1"],
    ["objects", "relationship_object_1"],
    ["messages", "senderId_1"],
  ];
  for (const [collection, name] of targets) {
    try {
      await db.collection(collection).dropIndex(name);
      console.log(`Dropped index ${name} on ${collection}`);
    } catch {
      console.log(`No index ${name} on ${collection} to drop`);
    }
  }
}
