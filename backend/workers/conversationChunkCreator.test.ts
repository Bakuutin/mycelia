import { expect } from "@std/expect";
import {
  findHistoricalUnassignedTranscriptions,
  hasPendingConversationChunkWork,
  unassignedTranscriptionQuery,
} from "./conversationChunkCreator.ts";

Deno.test("chunk creator auto-trigger runs for unassigned transcriptions", async () => {
  const calls: any[] = [];
  const hasWork = await hasPendingConversationChunkWork(async (input) => {
    calls.push(input);
    return input.collection === "transcriptions"
      ? [{ _id: "transcription" }]
      : [];
  });

  expect(hasWork).toBe(true);
  expect(calls).toHaveLength(1);
});

Deno.test("chunk creator auto-trigger runs when an open chunk needs finalizing", async () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const calls: any[] = [];
  const hasWork = await hasPendingConversationChunkWork(async (input) => {
    calls.push(input);
    return input.collection === "conversation_chunks" ? [{ _id: "chunk" }] : [];
  }, now);

  expect(hasWork).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1].query).toEqual({
    state: "open",
    $or: [
      { lastActivityAt: { $lt: new Date("2026-08-02T11:59:00.000Z") } },
      { end: { $lt: new Date("2026-08-02T11:55:00.000Z") } },
    ],
  });
});

Deno.test("chunk creator auto-trigger skips an idle poll", async () => {
  let calls = 0;
  const hasWork = await hasPendingConversationChunkWork(async () => {
    calls += 1;
    return [];
  });

  expect(hasWork).toBe(false);
  expect(calls).toBe(2);
});

Deno.test("historical selector includes legacy rows without createdAt", async () => {
  const legacy = {
    _id: "legacy-transcription",
    start: new Date("2025-07-03T10:00:00.000Z"),
    end: new Date("2025-07-03T10:05:00.000Z"),
    segments: [{ text: "legacy text" }],
  };
  const calls: any[] = [];
  const results = await findHistoricalUnassignedTranscriptions(
    async (input) => {
      calls.push(input);
      return [legacy];
    },
  );

  expect(calls[0].query).toEqual(unassignedTranscriptionQuery);
  expect(calls[0].query.createdAt).toBeUndefined();
  expect(results).toHaveLength(1);
  expect(results[0].text).toBe("legacy text");
  expect(results[0].createdAt).toBeUndefined();
});
