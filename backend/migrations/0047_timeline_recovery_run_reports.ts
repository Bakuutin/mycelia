import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEX_NAME = "timeline_recovery_runs_kind_created_at";

export const up = async (db: Db) => {
  await ensureIndexExists(
    db,
    "timeline_recovery_runs",
    { kind: 1, createdAt: -1 },
    { name: INDEX_NAME },
  );
};

export const down = async (db: Db) => {
  const collection = db.collection("timeline_recovery_runs");
  if (await collection.indexExists(INDEX_NAME)) {
    await collection.dropIndex(INDEX_NAME);
  }
};
