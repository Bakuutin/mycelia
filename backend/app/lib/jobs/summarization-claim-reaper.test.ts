import { expect } from "@std/expect";
import { releaseCompletedSummarizationClaims } from "./summarization-claim-reaper.ts";

Deno.test("completed summarization claim cleanup uses the sparse claim index and bounded ids", async () => {
  const calls: any[] = [];
  const result = await releaseCompletedSummarizationClaims(async (input) => {
    calls.push(input);
    if (input.action === "find") return [{ _id: "a" }, { _id: "b" }];
    return { modifiedCount: 2 };
  });

  expect(result).toEqual({ scanned: 2, modified: 2, hasMore: false });
  expect(calls[0].options).toMatchObject({
    hint: "summarizationClaim_startedAt_1",
    limit: 100,
    maxTimeMS: 2_000,
    projection: { _id: 1 },
  });
  expect(calls[1].query._id).toEqual({ $in: ["a", "b"] });
});

Deno.test("completed summarization claim cleanup skips update when no indexed claims exist", async () => {
  const calls: any[] = [];
  const result = await releaseCompletedSummarizationClaims(async (input) => {
    calls.push(input);
    return [];
  });

  expect(result).toEqual({ scanned: 0, modified: 0, hasMore: false });
  expect(calls).toHaveLength(1);
});
