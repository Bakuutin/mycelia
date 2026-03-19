import type { Db, Filter, UpdateFilter } from "mongodb";

const REQUEUEABLE_CONVERSATION_CHUNK_STATES = [
  "ready",
  "completed",
  "empty",
  "error",
] as const;

export function buildConversationChunkRequeueFilter(
  start: Date,
  end: Date,
): Filter<any> {
  return {
    state: { $in: [...REQUEUEABLE_CONVERSATION_CHUNK_STATES] },
    start: { $gte: start, $lt: end },
  };
}

export function buildConversationChunkRequeueUpdate(
  now = new Date(),
): UpdateFilter<any> {
  return {
    $set: {
      state: "ready",
      "params.force": true,
      updatedAt: now,
    },
    $unset: {
      error: "",
      processedByJobId: "",
      processingStartedAt: "",
    },
  };
}

export async function requeueConversationChunksInRange(
  db: Db,
  start: Date,
  end: Date,
  now = new Date(),
) {
  const filter = buildConversationChunkRequeueFilter(start, end);
  const update = buildConversationChunkRequeueUpdate(now);
  const result = await db.collection("conversation_chunks").updateMany(
    filter,
    update,
  );

  return {
    filter,
    matchedCount: result.matchedCount,
    modifiedCount: result.modifiedCount,
  };
}
