import { expect } from "@std/expect";
import type { Db } from "mongodb";
import { reconcileExpiredMediaEventRunsGlobally } from "./media-event-run-reaper.ts";

function fakeDb(owners: string[]) {
  const pipelines: unknown[][] = [];
  const db = {
    collection: () => ({
      aggregate: (pipeline: unknown[]) => {
        pipelines.push(pipeline);
        return {
          toArray: () =>
            Promise.resolve(
              owners.map((owner) => ({
                _id: owner,
                earliestLeaseExpiresAt: new Date(0),
              })),
            ),
        };
      },
    }),
  } as unknown as Db;
  return { db, pipelines };
}

Deno.test("global media event run reconciliation scans every discovered owner and totals outcomes", async () => {
  const now = new Date("2026-08-22T00:00:00.000Z");
  const { db, pipelines } = fakeDb(["a", "b"]);
  const seen: string[] = [];

  const result = await reconcileExpiredMediaEventRunsGlobally(
    db,
    (_db, owner, receivedNow) => {
      seen.push(owner);
      expect(receivedNow).toBe(now);
      return Promise.resolve(
        owner === "a"
          ? { released: 1, outcomeUnknown: 0, settlementPending: 0 }
          : { released: 0, outcomeUnknown: 2, settlementPending: 1 },
      );
    },
    now,
  );

  expect(seen).toEqual(["a", "b"]);
  expect(result).toEqual({
    ownersScanned: 2,
    released: 1,
    outcomeUnknown: 2,
    settlementPending: 1,
    ownerFailures: 0,
    hasMore: false,
  });
  expect(pipelines[0][0]).toEqual({
    $match: {
      owner: { $type: "string" },
      $or: [
        {
          state: "building",
          "executionClaim.phase": { $in: ["claimed", "started"] },
          "executionClaim.leaseExpiresAt": { $lte: now },
        },
        { "settlementPending.target": { $exists: true } },
      ],
    },
  });
});

Deno.test("global media event run reconciliation isolates transient owner failures for the next tick", async () => {
  const { db } = fakeDb(["broken", "healthy"]);

  const result = await reconcileExpiredMediaEventRunsGlobally(
    db,
    (_db, owner) => {
      if (owner === "broken") throw new Error("temporary settlement failure");
      return Promise.resolve({
        released: 1,
        outcomeUnknown: 0,
        settlementPending: 0,
      });
    },
  );

  expect(result).toMatchObject({
    ownersScanned: 2,
    released: 1,
    ownerFailures: 1,
    settlementPending: 1,
    hasMore: true,
  });
});
