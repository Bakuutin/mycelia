import { expect } from "@std/expect";
import { hasIndexedPendingWork } from "./pending-work.ts";

Deno.test("pending-work lookup uses a bounded indexed find", async () => {
  const calls: any[] = [];
  const result = await hasIndexedPendingWork(async (input) => {
    calls.push(input);
    return [{ _id: "pending" }];
  }, {
    collection: "items",
    query: { state: "ready" },
    hint: "items_pending_v1",
  });

  expect(result).toBe(true);
  expect(calls).toEqual([{
    action: "find",
    collection: "items",
    query: { state: "ready" },
    options: {
      projection: { _id: 1 },
      limit: 1,
      hint: "items_pending_v1",
    },
  }]);
});

Deno.test("pending-work lookup returns false for an empty cursor", async () => {
  expect(
    await hasIndexedPendingWork(async () => [], {
      collection: "items",
      query: { state: "ready" },
    }),
  ).toBe(false);
});
