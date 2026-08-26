import { expect } from "@std/expect";
import {
  type DiarizatorAdmissionCandidate,
  drainDiarizatorAdmissionCandidates,
} from "./diarizator-admission.ts";

const baseTime = Date.parse("2026-08-22T00:00:00.000Z");

function candidate(
  jobId: string,
  priority: number,
  queuedOffsetMs: number,
  providerProfileId?: string,
): DiarizatorAdmissionCandidate {
  return {
    jobId,
    jobType: "diarization",
    jobData: {
      type: "diarization",
      ...(providerProfileId
        ? {
          routingContext: {
            providerProfileId,
            resolvedAt: new Date(baseTime).toISOString(),
          },
        }
        : {}),
    },
    priority,
    createdAt: new Date(baseTime + queuedOffsetMs),
    queuedAt: new Date(baseTime + queuedOffsetMs),
  };
}

function dependencies(input: {
  getQueueState?: (
    candidate: DiarizatorAdmissionCandidate,
  ) => string | undefined;
  admit: (candidate: DiarizatorAdmissionCandidate) => void;
  admitted?: string[];
  deferred?: string[];
}) {
  return {
    getQueueState: (item: DiarizatorAdmissionCandidate) =>
      Promise.resolve(input.getQueueState?.(item)),
    removeTerminalQueueJob: () => Promise.resolve(),
    admit: (item: DiarizatorAdmissionCandidate) => {
      input.admit(item);
      return Promise.resolve();
    },
    markAdmitted: (item: DiarizatorAdmissionCandidate) => {
      input.admitted?.push(item.jobId);
      return Promise.resolve();
    },
    markDeferred: (item: DiarizatorAdmissionCandidate) => {
      input.deferred?.push(item.jobId);
      return Promise.resolve();
    },
    now: () => baseTime + 60_000,
  };
}

Deno.test("admission drain orders P1/P5/P10/P15/P20 and keeps FIFO ties", async () => {
  const order: string[] = [];
  const items = [
    candidate("p20", 20, 0),
    candidate("p10-new", 10, 30),
    candidate("p1", 1, 40),
    candidate("p15", 15, 10),
    candidate("p5", 5, 20),
    candidate("p10-old", 10, 5),
  ];

  const metrics = await drainDiarizatorAdmissionCandidates(
    items,
    dependencies({ admit: (item) => order.push(item.jobId) }),
  );

  expect(order).toEqual(["p1", "p5", "p10-old", "p10-new", "p15", "p20"]);
  expect(metrics.admitted).toBe(6);
  expect(metrics.failed).toBe(0);
});

Deno.test("admission drain continuously refills six slots without overbooking", async () => {
  const items = Array.from(
    { length: 8 },
    (_, index) => candidate(`job-${index + 1}`, 20, index),
  );
  const active = new Set<string>();
  let maximumOccupied = 0;
  const admit = (item: DiarizatorAdmissionCandidate) => {
    if (active.size >= 6) {
      throw new Error(
        "All healthy diarizator provider concurrency slots are reserved",
      );
    }
    active.add(item.jobId);
    maximumOccupied = Math.max(maximumOccupied, active.size);
  };
  const getQueueState = (item: DiarizatorAdmissionCandidate) =>
    active.has(item.jobId) ? "active" : undefined;

  const first = await drainDiarizatorAdmissionCandidates(
    items,
    dependencies({ admit, getQueueState }),
  );
  expect(first.admitted).toBe(6);
  expect(first.capacityBlocked).toBe(1);
  expect(active.size).toBe(6);

  active.delete("job-1");
  const second = await drainDiarizatorAdmissionCandidates(
    items.filter((item) => item.jobId !== "job-1"),
    dependencies({ admit, getQueueState }),
  );
  expect(second.admitted).toBe(1);
  expect(active.size).toBe(6);
  expect(maximumOccupied).toBe(6);
});

Deno.test("busy pinned route does not block another GPU", async () => {
  const order: string[] = [];
  const deferred: string[] = [];
  const metrics = await drainDiarizatorAdmissionCandidates(
    [
      candidate("pinned-busy", 1, 0, "gpu-1"),
      candidate("free-route", 5, 1),
    ],
    dependencies({
      admit: (item) => {
        if (item.jobId === "pinned-busy") {
          throw new Error(
            "Diarizator provider gpu-1 has no free concurrency slots",
          );
        }
        order.push(item.jobId);
      },
      deferred,
    }),
  );

  expect(deferred).toEqual(["pinned-busy"]);
  expect(order).toEqual(["free-route"]);
  expect(metrics.capacityBlocked).toBe(1);
  expect(metrics.admitted).toBe(1);
});

Deno.test("watchdog drain recovers work after a missed terminal event", async () => {
  const item = candidate("missed-event", 20, 0);
  let poolBusy = true;
  let admitted = false;
  const run = () =>
    drainDiarizatorAdmissionCandidates(
      [item],
      dependencies({
        admit: () => {
          if (poolBusy) {
            throw new Error(
              "All healthy diarizator provider concurrency slots are reserved",
            );
          }
          admitted = true;
        },
      }),
    );

  expect((await run()).capacityBlocked).toBe(1);
  expect(admitted).toBe(false);
  poolBusy = false;
  expect((await run()).admitted).toBe(1);
  expect(admitted).toBe(true);
});

Deno.test("live BullMQ job reconciles a raced admission marker", async () => {
  const marked: string[] = [];
  let admitCalls = 0;
  const metrics = await drainDiarizatorAdmissionCandidates(
    [
      candidate("already-active", 20, 0),
    ],
    dependencies({
      getQueueState: () => "active",
      admit: () => {
        admitCalls += 1;
      },
      admitted: marked,
    }),
  );

  expect(admitCalls).toBe(0);
  expect(marked).toEqual(["already-active"]);
  expect(metrics.reconciled).toBe(1);
});
