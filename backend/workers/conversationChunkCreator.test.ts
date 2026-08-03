import { expect } from "@std/expect";
import { hasPendingConversationChunkWork } from "./conversationChunkCreator.ts";

Deno.test("chunk creator auto-trigger runs for unassigned transcriptions", async () => {
  const calls: any[] = [];
  const hasWork = await hasPendingConversationChunkWork(async (input) => {
    calls.push(input);
    return input.collection === "transcriptions"
      ? { _id: "transcription" }
      : null;
  });

  expect(hasWork).toBe(true);
  expect(calls).toHaveLength(1);
});

Deno.test("chunk creator auto-trigger runs when an open chunk needs finalizing", async () => {
  const now = new Date("2026-08-02T12:00:00.000Z");
  const calls: any[] = [];
  const hasWork = await hasPendingConversationChunkWork(async (input) => {
    calls.push(input);
    return input.collection === "conversation_chunks" ? { _id: "chunk" } : null;
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
    return null;
  });

  expect(hasWork).toBe(false);
  expect(calls).toBe(2);
});
