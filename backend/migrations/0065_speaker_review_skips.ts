import { type Db, ObjectId } from "mongodb";

export async function up(db: Db): Promise<void> {
  const sessions = db.collection("speaker_review_sessions").find(
    { "window.status": "skipped" },
    {
      projection: {
        owner: 1,
        targetProfileIds: 1,
        window: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  );
  for await (const session of sessions) {
    const window = [...(session.window ?? [])];
    let changed = false;
    for (const item of window) {
      if (item.status !== "skipped" || item.decisionId) continue;
      const segmentId = item.segmentId instanceof ObjectId
        ? item.segmentId
        : new ObjectId(String(item.segmentId));
      const clientRequestId = "legacy-skip-" + String(segmentId);
      const decisionId = new ObjectId();
      const createdAt = session.updatedAt ?? session.createdAt ?? new Date();
      await db.collection("speaker_review_decisions").updateOne(
        { sessionId: session._id, clientRequestId },
        {
          $setOnInsert: {
            _id: decisionId,
            sessionId: session._id,
            clientRequestId,
            author: session.owner,
            segmentIds: [segmentId],
            targetProfileIds: session.targetProfileIds ?? [],
            outcome: "skipped",
            profileId: null,
            excludedProfileIds: [],
            source: "legacy_skip_backfill",
            status: "committed",
            annotationCount: 0,
            createdAt,
            committedAt: createdAt,
            updatedAt: createdAt,
          },
        },
        { upsert: true },
      );
      const decision = await db.collection("speaker_review_decisions").findOne(
        { sessionId: session._id, clientRequestId },
        { projection: { _id: 1 } },
      );
      if (decision?._id) {
        item.decisionId = decision._id;
        changed = true;
      }
    }
    if (changed) {
      await db.collection("speaker_review_sessions").updateOne(
        { _id: session._id },
        {
          $set: { window, updatedAt: new Date() },
          $inc: { revision: 1 },
        },
      );
    }
  }
}

export async function down(db: Db): Promise<void> {
  const decisions = await db.collection("speaker_review_decisions").find(
    { source: "legacy_skip_backfill" },
    { projection: { _id: 1, sessionId: 1, segmentIds: 1 } },
  ).toArray();
  for (const decision of decisions) {
    await db.collection("speaker_review_sessions").updateOne(
      { _id: decision.sessionId },
      {
        $unset: { "window.$[item].decisionId": "" },
        $inc: { revision: 1 },
      },
      {
        arrayFilters: [{
          "item.segmentId": { $in: decision.segmentIds ?? [] },
          "item.decisionId": decision._id,
        }],
      },
    );
  }
  await db.collection("speaker_review_decisions").deleteMany({
    source: "legacy_skip_backfill",
  });
}
