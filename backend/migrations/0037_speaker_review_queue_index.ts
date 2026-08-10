import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const INDEX = "speaker_identity_review_queue";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarizations",
    {
      lifecycleStatus: 1,
      "speakerIdentity.state": 1,
      "speakerIdentity.primaryScore": 1,
      start: 1,
      end: 1,
    },
    { name: INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (await db.collection("diarizations").indexExists(INDEX)) {
    await db.collection("diarizations").dropIndex(INDEX);
  }
}
