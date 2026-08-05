import { expect } from "@std/expect";
import {
  buildJsonSchemaResponseFormat,
  createSegmentParser,
  describeExtractionResult,
  formatChunkAsPrompt,
  getExtractionRetryDelayMs,
  metadataResponseSchema,
  normalizeEmoji,
  parseMetadataResponse,
  schema,
  shouldReplaceChunkArtifacts,
  transcriptionToUtterances,
} from "./conversationExtractor.ts";

Deno.test("conversation extraction retries back off and remain bounded", () => {
  expect(getExtractionRetryDelayMs(1)).toBe(5 * 60 * 1000);
  expect(getExtractionRetryDelayMs(2)).toBe(10 * 60 * 1000);
  expect(getExtractionRetryDelayMs(99)).toBe(6 * 60 * 60 * 1000);
});

Deno.test("STT segments become timestamped prompt utterances", () => {
  const utterances = transcriptionToUtterances({
    start: "2026-07-10T10:00:00.000Z",
    end: "2026-07-10T10:00:30.000Z",
    segments: [
      { start: 0, end: 10, text: " First topic " },
      { start: 10, end: 25, text: "Second topic" },
    ],
  });

  expect(utterances).toEqual([
    {
      start: new Date("2026-07-10T10:00:00.000Z"),
      end: new Date("2026-07-10T10:00:10.000Z"),
      text: "First topic",
    },
    {
      start: new Date("2026-07-10T10:00:10.000Z"),
      end: new Date("2026-07-10T10:00:25.000Z"),
      text: "Second topic",
    },
  ]);

  expect(formatChunkAsPrompt(utterances).prompt).toContain(
    "[time: 2026-07-10T10:00:10.000Z]\nSecond topic",
  );
});

Deno.test("stale chunk recovery replaces partial extraction artifacts", () => {
  expect(shouldReplaceChunkArtifacts("ready", false)).toBe(false);
  expect(shouldReplaceChunkArtifacts("processing", false)).toBe(true);
  expect(shouldReplaceChunkArtifacts("completed", true)).toBe(true);
});

Deno.test("segment parser resolves phrase boundaries through prompt time markers", () => {
  const parse = createSegmentParser(
    [
      "[time: 2026-07-28T08:00:00.000Z]",
      "First topic starts here",
      "[time: 2026-07-28T08:05:00.000Z]",
      "First topic ends here",
      "[time: 2026-07-28T08:10:00.000Z]",
    ],
    new Date("2026-07-28T07:55:00.000Z"),
    new Date("2026-07-28T08:15:00.000Z"),
  );

  expect(parse(JSON.stringify({
    segments: [{
      title: "First topic",
      start: "First topic starts here",
      end: "First topic ends here",
    }],
  }))).toEqual([{
    title: "First topic",
    start: new Date("2026-07-28T08:00:00.000Z"),
    end: new Date("2026-07-28T08:10:00.000Z"),
  }]);
});

Deno.test("conversation extractor defaults explicitly request metadata", () => {
  const input = schema.parse({ type: "conversation_extractor" });

  expect(input.extractorVersion).toBe("v2");
  expect(input.force).toBe(false);
  expect(input.retryNow).toBe(false);
  expect(input.model).toBeUndefined();
  expect(input.extraction_system_prompt).toContain("entities");
  expect(input.extraction_system_prompt).toContain("emoji");
  expect(input.extraction_system_prompt).toContain("agreed_upon_something");
});

Deno.test("forced historical extraction requires a targeted chunk", () => {
  expect(() => schema.parse({ type: "conversation_extractor", force: true }))
    .toThrow("force requires an explicit chunkId");

  const input = schema.parse({
    type: "conversation_extractor",
    chunkId: "6a6844e3dbdd95c011538c90",
    force: true,
    model: "medium",
  });
  expect(input.force).toBe(true);
  expect(input.model).toBe("medium");
});

Deno.test("extraction result description keeps explicit zero counts", () => {
  expect(describeExtractionResult({
    chunksProcessed: 1,
    segmentsFound: 0,
    conversationsCreated: 0,
    emojiCount: 0,
    entityCount: 0,
    agreementCount: 0,
    relationshipsCreated: 0,
    relationshipsAttempted: 0,
    relationshipErrors: 0,
  })).toContain("0 usable conversation segments");
});

Deno.test("metadata schema requires every extraction field", () => {
  expect(metadataResponseSchema.safeParse({}).success).toBe(false);
  expect(
    metadataResponseSchema.safeParse({
      agreed_upon_something: false,
      entities: [],
      emoji: "🗣️",
      tags: [],
    }).success,
  ).toBe(true);
  expect(
    metadataResponseSchema.safeParse({
      agreed_upon_something: false,
      entities: [{ name: "Mycelia", type: "product" }],
      emoji: "🗣️",
      tags: ["work"],
    }).success,
  ).toBe(true);
  // Bare strings are tolerated by the parser but not by the strict schema
  // that is advertised to the provider.
  expect(
    metadataResponseSchema.safeParse({
      agreed_upon_something: false,
      entities: ["Mycelia"],
      emoji: "🗣️",
      tags: [],
    }).success,
  ).toBe(false);
});

Deno.test("metadata parser normalizes emoji and deduplicates typed entities", () => {
  expect(parseMetadataResponse(JSON.stringify({
    agreed_upon_something: true,
    entities: [
      { name: "Mycelia", type: "product" },
      { name: " mycelia ", type: "organization" },
      { name: "OpenAI", type: "organization" },
      { name: "", type: "person" },
    ],
    emoji: "🧠 Knowledge",
  }))).toEqual({
    agreed_upon_something: true,
    entities: [
      { name: "Mycelia", type: "product" },
      { name: "OpenAI", type: "organization" },
    ],
    emoji: "🧠",
    tags: [],
  });
  expect(normalizeEmoji("🇬🇧")).toBe("🇬🇧");
});

Deno.test("metadata parser filters tags to known names", () => {
  const result = parseMetadataResponse(
    JSON.stringify({
      agreed_upon_something: false,
      entities: [],
      emoji: "🧠",
      tags: ["work", "Work", "hallucinated", "work", "family"],
    }),
    new Set(["work", "family", "health"]),
  );
  expect(result.tags).toEqual(["work", "family"]);

  // Without a tag list, tags are ignored entirely.
  expect(parseMetadataResponse(JSON.stringify({
    agreed_upon_something: false,
    entities: [],
    emoji: "🧠",
    tags: ["work"],
  })).tags).toEqual([]);
});

Deno.test("metadata parser accepts legacy string entities as untyped", () => {
  expect(parseMetadataResponse(JSON.stringify({
    agreed_upon_something: false,
    entities: ["Mycelia", " mycelia ", "OpenAI", ""],
    emoji: "🧠",
  })).entities).toEqual([
    { name: "Mycelia", type: "other" },
    { name: "OpenAI", type: "other" },
  ]);
});

Deno.test("metadata parser downgrades unknown entity types to other", () => {
  expect(parseMetadataResponse(JSON.stringify({
    agreed_upon_something: false,
    entities: [
      { name: "Шуши", type: "cat" },
      { name: "Amsterdam", type: "place" },
      { name: 42, type: "person" },
    ],
    emoji: "🧠",
  })).entities).toEqual([
    { name: "Шуши", type: "other" },
    { name: "Amsterdam", type: "place" },
  ]);
});

Deno.test("json_schema response format wraps the schema in the required envelope", () => {
  const format = buildJsonSchemaResponseFormat("conversation_metadata", {
    type: "object",
  });
  // Strict providers (vLLM, OpenRouter passthrough) reject a bare schema:
  // the {name, schema} envelope is mandatory.
  expect(format).toEqual({
    type: "json_schema",
    json_schema: {
      name: "conversation_metadata",
      schema: { type: "object" },
    },
  });
});

Deno.test("metadata parser rejects a response without an emoji", () => {
  expect(() =>
    parseMetadataResponse(JSON.stringify({
      agreed_upon_something: false,
      entities: [],
      emoji: "none",
    }))
  ).toThrow("Metadata response did not contain a valid emoji");
  expect(normalizeEmoji(undefined)).toBeUndefined();
});
