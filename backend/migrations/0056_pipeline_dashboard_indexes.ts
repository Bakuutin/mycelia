import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

export const TRANSCRIPTION_BATCH_HISTORY_INDEX =
  "jobs_transcription_completed_finishedAt_v1";
export const MAP_CONVERSATION_RANGE_INDEX =
  "objects_conversation_time_range_start_v1";

export async function up(db: Db): Promise<void> {
  await ensureIndexExists(
    db,
    "jobs",
    { type: 1, state: 1, finishedAt: -1 },
    {
      name: TRANSCRIPTION_BATCH_HISTORY_INDEX,
      partialFilterExpression: {
        state: "completed",
        "result.batchSize": { $exists: true },
      },
    },
  );
  await ensureIndexExists(
    db,
    "objects",
    { isConversation: 1, "timeRanges.start": 1 },
    { name: MAP_CONVERSATION_RANGE_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  if (
    await db.collection("jobs").indexExists(TRANSCRIPTION_BATCH_HISTORY_INDEX)
  ) {
    await db.collection("jobs").dropIndex(TRANSCRIPTION_BATCH_HISTORY_INDEX);
  }
  if (
    await db.collection("objects").indexExists(MAP_CONVERSATION_RANGE_INDEX)
  ) {
    await db.collection("objects").dropIndex(MAP_CONVERSATION_RANGE_INDEX);
  }
}
