import { expect } from "@std/expect";
import {
  buildConversationChunkClaimQuery,
  mergedResponseSchema,
  parseMergedResponse,
  schema,
} from "./conversationExtractorMerged.ts";

const CHUNK_START = new Date("2026-08-01T10:00:00.000Z");
const CHUNK_END = new Date("2026-08-01T11:00:00.000Z");
const PROMPT_LINES = [
  "[time: 2026-08-01T10:00:00.000Z]",
  "First topic starts here",
  "[time: 2026-08-01T10:20:00.000Z]",
  "First topic ends here",
  "[time: 2026-08-01T10:30:00.000Z]",
  "Second topic starts here",
  "[time: 2026-08-01T10:55:00.000Z]",
];

Deno.test("merged extractor defaults and schema", () => {
  const input = schema.parse({ type: "conversation_extractor_merged" });
  expect(input.limit).toBe(1);
  expect(input.force).toBe(false);
  expect(input.merged_system_prompt).toContain("segments");
  expect(input.merged_system_prompt).toContain("entities");

  expect(() =>
    schema.parse({ type: "conversation_extractor_merged", force: true })
  ).toThrow("force requires an explicit chunkId");

  expect(
    mergedResponseSchema.safeParse({
      segments: [{
        title: "T",
        start: "s",
        end: "e",
        emoji: "🧠",
        agreed_upon_something: false,
        entities: [{ name: "X", type: "person" }],
        tags: [],
      }],
    }).success,
  ).toBe(true);
});

Deno.test("merged extractor shares retry and stale claim eligibility", () => {
  const now = new Date("2026-08-15T04:00:00.000Z");
  expect(buildConversationChunkClaimQuery({}, now)).toEqual({
    $or: [
      { state: "ready" },
      { state: "error", extractionRetryAfter: { $lte: now } },
      { state: "error", extractionRetryAfter: { $exists: false } },
      {
        state: "processing",
        processingStartedAt: {
          $lt: new Date("2026-08-15T03:50:00.000Z"),
        },
      },
    ],
  });

  const retryNow = buildConversationChunkClaimQuery({ retryNow: true }, now);
  expect((retryNow.$or as any[])[1]).toEqual({ state: "error" });
});

Deno.test("merged response parses segments with metadata and boundaries", () => {
  const content = JSON.stringify({
    segments: [
      {
        title: "First topic",
        start: "First topic starts here",
        end: "First topic ends here",
        emoji: "💡 idea",
        agreed_upon_something: true,
        entities: [
          { name: "Шуши", type: "animal" },
          { name: " шуши ", type: "person" },
          { name: "AI", type: "concept" },
        ],
        tags: ["work", "hallucinated"],
      },
    ],
  });

  const segments = parseMergedResponse(
    content,
    PROMPT_LINES,
    CHUNK_START,
    CHUNK_END,
    new Set(["work", "family"]),
  );

  expect(segments).toHaveLength(1);
  const seg = segments[0];
  expect(seg.title).toBe("First topic");
  expect(seg.start).toEqual(new Date("2026-08-01T10:00:00.000Z"));
  expect(seg.end).toEqual(new Date("2026-08-01T10:30:00.000Z"));
  expect(seg.emoji).toBe("💡");
  expect(seg.agreed_upon_something).toBe(true);
  expect(seg.entities).toEqual([
    { name: "Шуши", type: "animal" },
    { name: "AI", type: "concept" },
  ]);
  expect(seg.droppedEntities).toBe(1); // case-insensitive duplicate
  expect(seg.tags).toEqual(["work"]);
  expect(seg.droppedTags).toBe(1); // unknown tag name
});

Deno.test("merged response records invalid emoji and unknown types", () => {
  const content = JSON.stringify({
    segments: [{
      title: "",
      start: "Second topic starts here",
      end: "nonexistent phrase",
      emoji: "none",
      agreed_upon_something: "yes",
      entities: [{ name: "Толя", type: "sandwich" }],
      tags: [],
    }],
  });

  const segments = parseMergedResponse(
    content,
    PROMPT_LINES,
    CHUNK_START,
    CHUNK_END,
    new Set(),
  );

  expect(segments).toHaveLength(1);
  const seg = segments[0];
  expect(seg.title).toBe("Conversation 1"); // empty title fallback
  expect(seg.emoji).toBeUndefined();
  expect(Boolean(seg.emoji)).toBe(false);
  expect(seg.rawEmoji).toBe("none");
  expect(seg.entities).toEqual([{ name: "Толя", type: "other" }]);
});

Deno.test("merged response with no segments yields empty list", () => {
  expect(
    parseMergedResponse(
      JSON.stringify({ segments: [] }),
      PROMPT_LINES,
      CHUNK_START,
      CHUNK_END,
      new Set(),
    ),
  ).toEqual([]);
});
