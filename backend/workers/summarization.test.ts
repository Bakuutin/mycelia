import { expect } from "@std/expect";
import { isTerminalSummarizationResponseError } from "./summarization.ts";

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
