import { Db } from "mongodb";
import type { MongoClient } from "mongodb";
import { ensureCollectionExists, ensureIndexExists } from "@/utils/migrations.ts";

export async function up(db: Db, _client: MongoClient): Promise<void> {
  console.log("Running migration 0017: Adding log indexes...");

  await ensureCollectionExists(db, "access_logs");
  await ensureIndexExists(
    db,
    "access_logs",
    { timestamp: 1 },
    { name: "timestamp" },
  );

  await ensureCollectionExists(db, "job_logs");
  await ensureIndexExists(
    db,
    "job_logs",
    { jobId: 1, timestamp: 1 },
    { name: "job_id_timestamp" },
  );
}

export async function down(db: Db, _client: MongoClient): Promise<void> {
  console.log("Rolling back migration 0017...");
  await db.collection("access_logs").dropIndex("timestamp");
  await db.collection("job_logs").dropIndex("job_id_timestamp");
}
