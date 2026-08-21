import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const SPEAKER_REVIEW_SOURCE_INDEX = "speaker_review_source_scan";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarizations",
    {
      embeddingSpaceId: 1,
      lifecycleStatus: 1,
      start: 1,
      _id: 1,
    },
    { name: SPEAKER_REVIEW_SOURCE_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (
    await db.collection("diarizations").indexExists(SPEAKER_REVIEW_SOURCE_INDEX)
  ) {
    await db.collection("diarizations").dropIndex(SPEAKER_REVIEW_SOURCE_INDEX);
  }
}
