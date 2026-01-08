import { Db, MongoClient } from "mongodb";
import { ensureCollectionExists, ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0006: Adding jobs collection and indexes...");

  await ensureCollectionExists(db, "jobs");

  await ensureIndexExists(
    db,
    "jobs",
    { type: 1, state: 1, createdAt: -1 },
    { name: "type_state" },
  );

  await ensureIndexExists(
    db,
    "jobs",
    { createdAt: -1 },
    { name: "created_at_desc" },
  );

  await ensureIndexExists(
    db,
    "jobs",
    { state: 1, createdAt: -1 },
    { name: "state" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0006: Removing jobs collection...");
  await db.dropCollection("jobs");
}
