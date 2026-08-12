import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEX_NAME = "timeline_objects_time_range_start";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "objects",
    { "timeRanges.start": 1 },
    { name: INDEX_NAME },
  );
}

export async function down(db: Db): Promise<void> {
  if (await db.collection("objects").indexExists(INDEX_NAME)) {
    await db.collection("objects").dropIndex(INDEX_NAME);
  }
}
