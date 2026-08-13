import { expect } from "@std/expect";
import {
  getContinuationJobData,
  getContinuationPriority,
  shouldContinueJobChain,
} from "./job-chain.ts";

Deno.test("job chaining continues only after measurable progress", () => {
  expect(shouldContinueJobChain({ hasMore: true, processed: 1 })).toBe(true);
  expect(shouldContinueJobChain({ hasMore: true, processed: 25 })).toBe(true);
});

Deno.test("diarization priority keeps live recordings ahead of historical work", () => {
  expect(getContinuationPriority({
    type: "diarization",
    originalId: "recording-1",
  })).toBe(1);
  expect(getContinuationPriority({
    type: "diarization",
    mode: "build_generation",
  })).toBe(5);
  expect(getContinuationPriority({ type: "diarization", mode: "missing" }))
    .toBe(10);
});

Deno.test("job chaining stops when work is exhausted or no progress was made", () => {
  expect(shouldContinueJobChain({ hasMore: false, processed: 10 })).toBe(false);
  expect(shouldContinueJobChain({ hasMore: true, processed: 0 })).toBe(false);
  expect(shouldContinueJobChain({ hasMore: true })).toBe(false);
  expect(shouldContinueJobChain(undefined)).toBe(false);
});

Deno.test("summarization continuation refreshes prompt and model defaults", () => {
  expect(getContinuationJobData({
    type: "summarization",
    prompt: "Sky Summarizer Prompt (v5)",
    promptName: "Old prompt",
    model: "small",
  })).toEqual({ type: "summarization" });
});

Deno.test("other job continuations preserve their validated data", () => {
  const data = { type: "transcription", limit: 10 };
  expect(getContinuationJobData(data)).toBe(data);
});

Deno.test("cursor-based workers advance their continuation cursor", () => {
  const data = { type: "speakerIdentity", cursor: "old" };
  expect(getContinuationJobData(data, {
    cursor: "new",
    campaignId: "identity-1",
  })).toEqual({
    type: "speakerIdentity",
    cursor: "new",
    campaignId: "identity-1",
  });
});

Deno.test("timeline rebuild continuation advances the bounded range", () => {
  const data = {
    type: "histRecalculation",
    start: "2026-01-01T00:00:00.000Z",
    end: "2026-02-01T00:00:00.000Z",
    staleOnly: false,
    timelineRebuildBatchIndex: 0,
  };
  expect(getContinuationJobData(data, {
    nextStart: "2026-02-01T00:00:00.000Z",
    nextEnd: "2026-03-04T00:00:00.000Z",
    timelineRebuildBatchIndex: 1,
  })).toEqual({
    ...data,
    start: "2026-02-01T00:00:00.000Z",
    end: "2026-03-04T00:00:00.000Z",
    timelineRebuildBatchIndex: 1,
  });
});

Deno.test("diarization continuation adopts the campaign created by the first batch", () => {
  expect(getContinuationJobData(
    { type: "diarization", mode: "missing", limit: 4 },
    { campaignId: "campaign-1", cursor: "2026-08-10T00:00:00Z" },
  )).toEqual({
    type: "diarization",
    mode: "missing",
    limit: 4,
    campaignId: "campaign-1",
    cursor: "2026-08-10T00:00:00.000Z",
  });
});

Deno.test("diarization continuation normalizes Python UTC offsets", () => {
  expect(getContinuationJobData(
    { type: "diarization", mode: "missing" },
    { campaignId: "campaign-1", cursor: "2026-08-10T00:00:00.123000+00:00" },
  )).toMatchObject({
    campaignId: "campaign-1",
    cursor: "2026-08-10T00:00:00.123Z",
  });
});
