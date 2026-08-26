import { expect } from "@std/expect";
import { ObjectId } from "bson";
import { transcriptionToUtterances } from "@/lib/extraction/shared.ts";
import {
  ChunkingEngine,
  findHistoricalUnassignedTranscriptions,
  hasPendingConversationChunkWork,
  schema,
  unassignedTranscriptionQuery,
} from "./conversationChunkCreator.ts";

const GAP_THRESHOLDS = {
  sparse: 45 * 60 * 1000,
  normal: 5 * 60 * 1000,
  dense: 40 * 1000,
};
const CHAR_THRESHOLDS = { sparseMax: 500, normalMax: 20_000 };

function unit(
  source: string,
  start: string,
  text: string,
) {
  const end = new Date(new Date(start).getTime() + 30_000);
  const transcription = {
    start,
    end,
    text,
  };
  return {
    _id: new ObjectId(),
    original: new ObjectId(source),
    start: new Date(start),
    end,
    text,
    promptUtterances: transcriptionToUtterances(transcription),
  };
}

Deno.test("chunk creator defaults to a 32k prompt cap", () => {
  const input = schema.parse({ type: "conversation_chunk_creator" });
  expect(input.maxPromptChars).toBe(32_000);
});

Deno.test("backfill chunking separates source files regardless of gap", () => {
  const engine = new ChunkingEngine(
    GAP_THRESHOLDS,
    CHAR_THRESHOLDS,
    32_000,
  );
  const sourceA = "64b000000000000000000001";
  const sourceB = "64b000000000000000000002";

  expect(
    engine.process(unit(sourceB, "2026-08-01T10:00:31.000Z", "newer")),
  ).toBeNull();
  const split = engine.process(
    unit(sourceA, "2026-08-01T10:00:00.000Z", "older"),
  );

  expect(split?.splitReason).toBe("source_change");
  expect(split?.transcriptionIds).toHaveLength(1);
  expect(split?.original_id?.toString()).toBe(sourceB);
});

Deno.test("backfill chunking finalizes before exceeding prompt cap", () => {
  const engine = new ChunkingEngine(GAP_THRESHOLDS, CHAR_THRESHOLDS, 400);
  const source = "64b000000000000000000001";

  expect(
    engine.process(
      unit(source, "2026-08-01T10:01:00.000Z", "a".repeat(180)),
    ),
  ).toBeNull();
  const split = engine.process(
    unit(source, "2026-08-01T10:00:00.000Z", "b".repeat(180)),
  );

  expect(split?.splitReason).toBe("prompt_limit");
  expect(split?.promptChars).toBeLessThanOrEqual(400);
  expect(engine.finalize()?.promptChars).toBeLessThanOrEqual(400);
});

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
