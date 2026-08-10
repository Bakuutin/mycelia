import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const DIARIZATION_PENDING_INDEX = "audio_chunks_diarization_pending_v2";
export const DIARIZATION_COVERAGE_INDEX =
  "audio_chunks_diarization_coverage_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      "vad.has_speech": 1,
      diarized_at: 1,
      processing_by: 1,
      start: 1,
      original_id: 1,
      index: 1,
    },
    {
      name: DIARIZATION_PENDING_INDEX,
      partialFilterExpression: { "vad.has_speech": true },
    },
  );
  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      "vad.has_speech": 1,
      start: 1,
      diarized_at: 1,
      processing_by: 1,
      "diarizationFailure.status": 1,
    },
    {
      name: DIARIZATION_COVERAGE_INDEX,
      partialFilterExpression: { "vad.has_speech": true },
    },
  );
}

export async function down(db: Db): Promise<void> {
  for (const name of [DIARIZATION_PENDING_INDEX, DIARIZATION_COVERAGE_INDEX]) {
    if (await db.collection("audio_chunks").indexExists(name)) {
      await db.collection("audio_chunks").dropIndex(name);
    }
  }
}
