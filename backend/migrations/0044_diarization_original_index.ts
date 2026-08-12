import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

/**
 * The diarization worker queries `diarizations` by `original_id` twice per
 * sequence: once for the overlap segments it reconciles speaker labels
 * against, and once for the labels already reserved on that recording. No
 * index covered `original_id`, so both were collection scans over every
 * segment ever written and diarization throughput decayed as the archive grew.
 *
 * `start` serves the overlap range scan; `speaker` keeps the reserved-label
 * grouping covered so it never fetches documents.
 */
export const DIARIZATION_ORIGINAL_INDEX = "diarization_original_start_speaker";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "diarizations",
    { original_id: 1, start: 1, speaker: 1 },
    { name: DIARIZATION_ORIGINAL_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (await db.collection("diarizations").indexExists(DIARIZATION_ORIGINAL_INDEX)) {
    await db.collection("diarizations").dropIndex(DIARIZATION_ORIGINAL_INDEX);
  }
}
