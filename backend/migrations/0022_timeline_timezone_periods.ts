import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const COLLECTION = "timeline_timezone_periods";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, COLLECTION);
  await ensureIndexExists(
    db,
    COLLECTION,
    { start: 1, end: 1 },
    { name: "timeline_timezone_period_range" },
  );
  await ensureIndexExists(
    db,
    COLLECTION,
    { createdAt: 1 },
    { name: "timeline_timezone_period_created" },
  );
}

export async function down(db: Db): Promise<void> {
  const collection = db.collection(COLLECTION);
  for (
    const name of [
      "timeline_timezone_period_range",
      "timeline_timezone_period_created",
    ]
  ) {
    if (await collection.indexExists(name)) await collection.dropIndex(name);
  }
}
