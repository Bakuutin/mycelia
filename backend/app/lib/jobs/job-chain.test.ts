import { expect } from "@std/expect";
import { shouldContinueJobChain } from "./job-chain.ts";

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
