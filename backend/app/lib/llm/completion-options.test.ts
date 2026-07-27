import { expect } from "@std/expect";
import { getSummaryCompletionOptions } from "./completion-options.ts";

Deno.test("disables hidden reasoning for Qwen GGUF summaries", () => {
  expect(
    getSummaryCompletionOptions(
      "Qwen3.6-27B-NEO-CODE-HERE-2T-OT-Q4_K_S.gguf",
    ),
  ).toEqual({
    reasoning_budget: 0,
    chat_template_kwargs: { enable_thinking: false },
  });
});

Deno.test("does not send llama.cpp options to unrelated providers", () => {
  expect(getSummaryCompletionOptions("another-provider-model")).toEqual({});
  expect(getSummaryCompletionOptions("small")).toEqual({});
});
