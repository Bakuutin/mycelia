import { expect } from "@std/expect";
import { getContinuationJobData, shouldContinueJobChain } from "./job-chain.ts";

Deno.test("job chaining continues only after measurable progress", () => {
  expect(shouldContinueJobChain({ hasMore: true, processed: 1 })).toBe(true);
  expect(shouldContinueJobChain({ hasMore: true, processed: 25 })).toBe(true);
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
