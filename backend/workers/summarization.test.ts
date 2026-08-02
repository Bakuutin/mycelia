import { expect } from "@std/expect";
import {
  buildSummarySourceRefs,
  getSummarizationRetryDelayMs,
  isConversationClaimActive,
  isTerminalSummarizationResponseError,
} from "./summarization.ts";

Deno.test("summarization retries back off and remain bounded", () => {
  expect(getSummarizationRetryDelayMs(1)).toBe(15 * 60 * 1000);
  expect(getSummarizationRetryDelayMs(2)).toBe(30 * 60 * 1000);
  expect(getSummarizationRetryDelayMs(99)).toBe(24 * 60 * 60 * 1000);
});

Deno.test("a batch claim stays active beyond the normal worker timeout", () => {
  const now = Date.parse("2026-07-30T00:30:00.000Z");
  expect(isConversationClaimActive({
    startedAt: "2026-07-30T00:00:00.000Z",
    holdUntil: "2026-07-31T00:00:00.000Z",
  }, now)).toBe(true);
  expect(isConversationClaimActive({
    startedAt: "2026-07-30T00:00:00.000Z",
    holdUntil: "2026-07-30T00:20:00.000Z",
  }, now)).toBe(false);
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
