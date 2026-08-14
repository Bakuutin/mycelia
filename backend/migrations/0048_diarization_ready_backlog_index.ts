import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const DIARIZATION_READY_BACKLOG_INDEX =
  "audio_chunks_diarization_ready_backlog_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "audio_chunks",
    {
      "vad.has_speech": 1,
      diarized_at: 1,
      processing_by: 1,
      "diarizationFailure.status": 1,
      "diarizationFailure.retryAt": 1,
      start: 1,
      original_id: 1,
      index: 1,
    },
    {
      name: DIARIZATION_READY_BACKLOG_INDEX,
      partialFilterExpression: { "vad.has_speech": true },
    },
  );
}

export async function down(db: Db): Promise<void> {
  if (
    await db.collection("audio_chunks").indexExists(
      DIARIZATION_READY_BACKLOG_INDEX,
    )
  ) {
    await db.collection("audio_chunks").dropIndex(
      DIARIZATION_READY_BACKLOG_INDEX,
    );
  }
}
