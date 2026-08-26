import { expect } from "@std/expect";
import type { Job } from "bullmq";
import type { JobData } from "./types.ts";
import {
  deferInProgressMediaEventJob,
  mediaEventInProgressRetryAt,
} from "./media-event-in-progress-delay.ts";

Deno.test("media event in-progress retry uses the run lease timestamp plus a settlement margin", () => {
  const now = new Date("2026-08-22T00:00:00.000Z");
  expect(
    mediaEventInProgressRetryAt({
      inProgress: true,
      retryAt: "2026-08-22T00:05:00.000Z",
    }, now)?.toISOString(),
  ).toBe("2026-08-22T00:05:01.000Z");
  expect(mediaEventInProgressRetryAt({ success: true }, now)).toBeNull();
});

Deno.test("in-progress media event job is durably marked waiting before BullMQ delay", async () => {
  const now = new Date("2026-08-22T00:00:00.000Z");
  const calls: any[] = [];
  let delayedUntil = 0;
  const job = {
    id: "68a8d900b2d2f9c821650111",
    token: "active-lock-token",
    data: { type: "mediaEventAggregation" },
    moveToDelayed: (timestamp: number, token: string) => {
      delayedUntil = timestamp;
      expect(token).toBe("active-lock-token");
      return Promise.resolve();
    },
  } as unknown as Job<JobData>;

  await expect(
    deferInProgressMediaEventJob(
      job,
      {
        inProgress: true,
        runId: "run-1",
        retryAt: "2026-08-22T00:05:00.000Z",
      },
      (input) => {
        calls.push(input);
        return Promise.resolve({ modifiedCount: 1 });
      },
      now,
    ),
  ).rejects.toMatchObject({ name: "DelayedError" });

  expect(delayedUntil).toBe(
    new Date("2026-08-22T00:05:01.000Z").getTime(),
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    collection: "jobs",
    query: { type: "mediaEventAggregation", state: "active" },
    update: {
      $set: {
        state: "waiting",
        delayedRecovery: {
          reason: "media_event_run_in_progress",
          runId: "run-1",
        },
      },
    },
  });
});
