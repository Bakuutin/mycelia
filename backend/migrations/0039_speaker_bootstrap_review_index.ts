import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEX = "speaker_bootstrap_review";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarizations",
    { lifecycleStatus: 1, start: -1 },
    { name: INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (await db.collection("diarizations").indexExists(INDEX)) {
    await db.collection("diarizations").dropIndex(INDEX);
  }
}
