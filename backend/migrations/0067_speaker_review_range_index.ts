import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const SPEAKER_REVIEW_RANGE_INDEX = "speaker_review_range_scan";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarizations",
    {
      embeddingSpaceId: 1,
      lifecycleStatus: 1,
      end: 1,
      start: 1,
      _id: 1,
    },
    { name: SPEAKER_REVIEW_RANGE_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (
    await db.collection("diarizations").indexExists(
      SPEAKER_REVIEW_RANGE_INDEX,
    )
  ) {
    await db.collection("diarizations").dropIndex(
      SPEAKER_REVIEW_RANGE_INDEX,
    );
  }
}
