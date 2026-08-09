import { expect } from "@std/expect";
import { buildJsonSchemaResponseFormat } from "../llm/worker-response.ts";
import {
  createSegmentParser,
  formatChunkAsPrompt,
  getExtractionRetryDelayMs,
  normalizeEmoji,
  transcriptionToUtterances,
} from "./shared.ts";

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

Deno.test("emoji normalization keeps one emoji grapheme", () => {
  expect(normalizeEmoji("🧠 Knowledge")).toBe("🧠");
  expect(normalizeEmoji("🇬🇧")).toBe("🇬🇧");
  expect(normalizeEmoji("none")).toBeUndefined();
  expect(normalizeEmoji(undefined)).toBeUndefined();
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
