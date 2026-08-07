import { expect } from "@std/expect";
import { z } from "zod";
import {
  buildSummarySourceRefs,
  getSummarizationRetryDelayMs,
  isTerminalSummarizationResponseError,
  parseSummaryTitleResponse,
  schema,
} from "./summarization.ts";

Deno.test("summarization schema defaults and bounds batchSize", () => {
  const parsed = schema.parse({ type: "summarization" });
  expect(parsed.batchSize).toBe(25);

  expect(schema.safeParse({ type: "summarization", batchSize: 0 }).success)
    .toBe(false);
  expect(schema.safeParse({ type: "summarization", batchSize: 101 }).success)
    .toBe(false);

  // The Jobs page batch column auto-detects workers by these JSON schema
  // properties — guard the contract.
  const json = z.toJSONSchema(schema) as {
    properties: Record<string, Record<string, unknown>>;
  };
  expect(json.properties.batchSize.type).toBe("integer");
  expect(json.properties.batchSize.minimum).toBe(1);
  expect(json.properties.batchSize.maximum).toBe(100);
  expect(json.properties.batchSize.default).toBe(25);
});

Deno.test("combined summary+title response parses JSON and fenced JSON", () => {
  expect(parseSummaryTitleResponse(
    JSON.stringify({ summary: "We talked about cats.", title: " \"Cats\" " }),
  )).toEqual({ summary: "We talked about cats.", title: "Cats" });

  expect(parseSummaryTitleResponse(
    '```json\n{"summary": "S", "title": "T"}\n```',
  )).toEqual({ summary: "S", title: "T" });
});

Deno.test("combined summary+title response falls back on plain text", () => {
  // Model ignored the JSON contract → caller uses the whole text as summary.
  expect(parseSummaryTitleResponse("Just a plain summary.")).toBeNull();
  expect(parseSummaryTitleResponse('{"summary": "only summary"}')).toBeNull();
  expect(parseSummaryTitleResponse('{"title": "only title"}')).toBeNull();
});

Deno.test("summarization retries back off and remain bounded", () => {
  expect(getSummarizationRetryDelayMs(1)).toBe(15 * 60 * 1000);
  expect(getSummarizationRetryDelayMs(2)).toBe(30 * 60 * 1000);
  expect(getSummarizationRetryDelayMs(99)).toBe(24 * 60 * 60 * 1000);
});

Deno.test("summary source receipt records exact chunks and transcripts", () => {
  const refs = buildSummarySourceRefs(
    [
      { _id: "transcription-1" },
      { _id: { toString: () => "transcription-2" } },
      { _id: "transcription-1" },
    ],
    new Date("2026-07-28T10:00:00.000Z"),
    new Date("2026-07-28T10:05:00.000Z"),
    {
      conversationId: "conversation-1",
      conversationChunkIds: ["chunk-1", "chunk-1"],
      extractorJobId: "extractor-job-1",
    },
  );

  expect(refs).toEqual({
    schemaVersion: "v1",
    selection: "time_range_overlap",
    conversationId: "conversation-1",
    conversationChunkIds: ["chunk-1"],
    transcriptionIds: ["transcription-1", "transcription-2"],
    coverageStart: "2026-07-28T10:00:00.000Z",
    coverageEnd: "2026-07-28T10:05:00.000Z",
    extractorJobId: "extractor-job-1",
  });
});

Deno.test("terminal completion responses are quarantined", () => {
  expect(isTerminalSummarizationResponseError(
    'LLM_INVALID_RESPONSE: finish_reason: "content_filter: PROHIBITED_CONTENT"',
  ))
    .toBe(true);
  expect(isTerminalSummarizationResponseError(
    "LLM_EMPTY_RESPONSE: blocked by safety policy",
  ))
    .toBe(true);
});

Deno.test("provider-wide response and transport failures remain retryable", () => {
  expect(isTerminalSummarizationResponseError("LLM_INVALID_RESPONSE: bad"))
    .toBe(false);
  expect(isTerminalSummarizationResponseError("LLM_EMPTY_RESPONSE: empty"))
    .toBe(false);
  expect(isTerminalSummarizationResponseError("LLM API error (502)"))
    .toBe(false);
  expect(isTerminalSummarizationResponseError("connection refused"))
    .toBe(false);
});

Deno.test("hasPendingWork reports jobs worth starting, not just a boolean", async () => {
  const capability = (await import("./summarization.ts")).default;
  const calls: any[] = [];
  const fakeMongo = (pending: number, batchSize?: number) => (input: any) => {
    calls.push(input);
    if (input.action === "count") return Promise.resolve(pending);
    if (input.action === "findOne" && input.collection === "workers") {
      return Promise.resolve(
        batchSize === undefined ? null : { defaultOverrides: { batchSize } },
      );
    }
    return Promise.resolve(null);
  };

  // Empty queue: 0 jobs, and the workers collection is not even consulted.
  calls.length = 0;
  expect(await capability.hasPendingWork!({
    mongo: fakeMongo(0),
    reason: "test",
  })).toBe(0);
  expect(calls.length).toBe(1);
  // The count must use the indexed subfield predicate.
  expect(calls[0].query["summaries.0.date"]).toEqual({ $exists: false });
  expect(calls[0].query.isConversation).toBe(true);

  // Backlog splits into ceil(pending / batchSize) jobs.
  expect(await capability.hasPendingWork!({
    mongo: fakeMongo(25, 10),
    reason: "test",
  })).toBe(3);

  // No operator override falls back to the schema default batch of 25.
  expect(await capability.hasPendingWork!({
    mongo: fakeMongo(26),
    reason: "test",
  })).toBe(2);

  // A single stray conversation still yields exactly one job.
  expect(await capability.hasPendingWork!({
    mongo: fakeMongo(1, 10),
    reason: "test",
  })).toBe(1);
});
