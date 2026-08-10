import type { Db } from "mongodb";
import {
  ensureCollectionExists,
  ensureIndexExists,
} from "@/utils/migrations.ts";

const SESSIONS = "speaker_review_sessions";
const DECISIONS = "speaker_review_decisions";

export async function up(db: Db): Promise<void> {
  await ensureCollectionExists(db, SESSIONS);
  await ensureCollectionExists(db, DECISIONS);

  await ensureIndexExists(
    db,
    SESSIONS,
    { owner: 1, status: 1, lastOpenedAt: -1 },
    { name: "speaker_review_session_owner_status" },
  );
  await ensureIndexExists(
    db,
    SESSIONS,
    { targetProfileIds: 1, status: 1, lastOpenedAt: -1 },
    { name: "speaker_review_session_profile_status" },
  );
  await ensureIndexExists(
    db,
    DECISIONS,
    { sessionId: 1, clientRequestId: 1 },
    { name: "speaker_review_decision_request", unique: true },
  );
  await ensureIndexExists(
    db,
    "speaker_annotations",
    { decisionId: 1, segmentId: 1 },
    {
      name: "speaker_annotation_decision_segment",
      unique: true,
      partialFilterExpression: { decisionId: { $exists: true } },
    },
  );
}

export async function down(db: Db): Promise<void> {
  for (
    const [collection, name] of [
      [SESSIONS, "speaker_review_session_owner_status"],
      [SESSIONS, "speaker_review_session_profile_status"],
      [DECISIONS, "speaker_review_decision_request"],
      ["speaker_annotations", "speaker_annotation_decision_segment"],
    ] as const
  ) {
    if (await db.collection(collection).indexExists(name)) {
      await db.collection(collection).dropIndex(name);
    }
  }
}
