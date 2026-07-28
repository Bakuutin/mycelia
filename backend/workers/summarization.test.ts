import { expect } from "jsr:@std/expect";
import { isTerminalSummarizationResponseError } from "./summarization.ts";

Deno.test("terminal completion responses are quarantined", () => {
  expect(isTerminalSummarizationResponseError("LLM_INVALID_RESPONSE: bad"))
    .toBe(true);
  expect(isTerminalSummarizationResponseError("LLM_EMPTY_RESPONSE: empty"))
    .toBe(true);
});

Deno.test("transport failures remain retryable", () => {
  expect(isTerminalSummarizationResponseError("LLM API error (502)"))
    .toBe(false);
  expect(isTerminalSummarizationResponseError("connection refused"))
    .toBe(false);
});
