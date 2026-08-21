import type { Db } from "mongodb";
import { ensureIndexExists } from "@/utils/migrations.ts";

const HISTORY_INDEX = "speaker_review_history_by_profile";
const CURRENT_SEGMENT_INDEX = "speaker_review_current_segment";

export async function up(db: Db): Promise<void> {
  const sessions = db.collection("speaker_review_sessions").find(
    { targetProfileIds: { $exists: true, $ne: [] } },
    { projection: { targetProfileIds: 1 } },
  );
  for await (const session of sessions) {
    await db.collection("speaker_review_decisions").updateMany(
      {
        sessionId: session._id,
        targetProfileIds: { $exists: false },
      },
      { $set: { targetProfileIds: session.targetProfileIds } },
    );
  }
  await ensureIndexExists(
    db,
    "speaker_review_decisions",
    { author: 1, status: 1, targetProfileIds: 1, updatedAt: -1 },
    { name: HISTORY_INDEX },
  );
  await ensureIndexExists(
    db,
    "speaker_review_decisions",
    { author: 1, status: 1, segmentIds: 1, updatedAt: -1 },
    { name: CURRENT_SEGMENT_INDEX },
  );
}

export async function down(db: Db): Promise<void> {
  const collection = db.collection("speaker_review_decisions");
  for (const name of [HISTORY_INDEX, CURRENT_SEGMENT_INDEX]) {
    if (await collection.indexExists(name)) await collection.dropIndex(name);
  }
}
