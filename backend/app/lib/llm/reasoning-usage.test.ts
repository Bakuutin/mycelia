import { expect } from "@std/expect";
import { getReasoningTokens } from "./reasoning-usage.ts";

Deno.test("reasoning tokens read from completion_tokens_details or flat field", () => {
  expect(getReasoningTokens({
    completion_tokens: 900,
    completion_tokens_details: { reasoning_tokens: 640 },
  })).toBe(640);
  expect(getReasoningTokens({ reasoning_tokens: 120 })).toBe(120);
  expect(getReasoningTokens({ completion_tokens: 900 })).toBeUndefined();
  expect(getReasoningTokens(undefined)).toBeUndefined();
  expect(getReasoningTokens("nope")).toBeUndefined();
});
