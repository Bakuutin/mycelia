import { expect } from "@std/expect";
import { ObjectId } from "bson";
import { withFixtures } from "@/tests/fixtures.server.ts";
import { buildConversationChunkRequeueFilter, requeueConversationChunksInRange } from "../conversationChunkRequeue.ts";

Deno.test("buildConversationChunkRequeueFilter targets finalized chunks in range", () => {
  const start = new Date("2026-03-12T00:00:00.000Z");
  const end = new Date("2026-03-19T00:00:00.000Z");

  expect(buildConversationChunkRequeueFilter(start, end)).toEqual({
    state: { $in: ["ready", "completed", "empty", "error"] },
    start: { $gte: start, $lt: end },
  });
});

Deno.test(
  "requeueConversationChunksInRange marks eligible chunks ready and force=true",
  withFixtures(["Mongo"], async ({ db }: { db: any }) => {
    const now = new Date("2026-03-19T12:00:00.000Z");
    const inRange = new Date("2026-03-15T12:00:00.000Z");
    const outOfRange = new Date("2026-03-01T12:00:00.000Z");

    const completedId = new ObjectId();
    const emptyId = new ObjectId();
    const openId = new ObjectId();
    const oldId = new ObjectId();

    await db.collection("conversation_chunks").insertMany([
      {
        _id: completedId,
        state: "completed",
        start: inRange,
        params: { model: "medium", force: false },
        processingStartedAt: new Date("2026-03-15T13:00:00.000Z"),
        processedByJobId: "job-1",
        error: "old error",
      },
      {
        _id: emptyId,
        state: "empty",
        start: inRange,
        params: { model: "medium", force: false },
      },
      {
        _id: openId,
        state: "open",
        start: inRange,
        params: { model: "medium", force: false },
      },
      {
        _id: oldId,
        state: "completed",
        start: outOfRange,
        params: { model: "medium", force: false },
      },
    ]);

    const result = await requeueConversationChunksInRange(
      db,
      new Date("2026-03-12T00:00:00.000Z"),
      new Date("2026-03-19T00:00:00.000Z"),
      now,
    );

    expect(result.matchedCount).toBe(2);
    expect(result.modifiedCount).toBe(2);

    const completed = await db.collection("conversation_chunks").findOne({ _id: completedId });
    const empty = await db.collection("conversation_chunks").findOne({ _id: emptyId });
    const open = await db.collection("conversation_chunks").findOne({ _id: openId });
    const old = await db.collection("conversation_chunks").findOne({ _id: oldId });

    expect(completed?.state).toBe("ready");
    expect(completed?.params?.force).toBe(true);
    expect(completed?.updatedAt).toEqual(now);
    expect(completed?.processingStartedAt).toBeUndefined();
    expect(completed?.processedByJobId).toBeUndefined();
    expect(completed?.error).toBeUndefined();

    expect(empty?.state).toBe("ready");
    expect(empty?.params?.force).toBe(true);
    expect(open?.state).toBe("open");
    expect(old?.state).toBe("completed");
  }),
);
