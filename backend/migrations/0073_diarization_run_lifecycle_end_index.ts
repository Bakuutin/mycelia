import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const COLLECTION = "diarizations";
const INDEX = "diarization_run_lifecycle_end";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    COLLECTION,
    { runId: 1, lifecycleStatus: 1, end: 1, start: 1 },
    { name: INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (await db.collection(COLLECTION).indexExists(INDEX)) {
    await db.collection(COLLECTION).dropIndex(INDEX);
  }
}
