import { expect } from "@std/expect";
import {
  buildTimelineRebuildBatches,
  buildTimelineRebuildRangeBatches,
  deriveTimelineCampaignRecoveryStatus,
  findTimelineRepairRanges,
  timelineCampaignStatus,
  timelineVerificationOutcome,
} from "./timeline-recovery.ts";

Deno.test("timeline rebuild batches are contiguous and cover the exact range", () => {
  const start = new Date("2026-01-15T12:00:00.000Z");
  const end = new Date("2026-04-02T18:00:00.000Z");
  const batches = buildTimelineRebuildBatches(start, end, 31);

  expect(batches).toHaveLength(3);
  expect(batches[0].start).toEqual(start);
  expect(batches.at(-1)?.end).toEqual(end);
  for (let index = 1; index < batches.length; index++) {
    expect(batches[index].start).toEqual(batches[index - 1].end);
    expect(batches[index].batchIndex).toBe(index);
  }
});

Deno.test("timeline rebuild rejects empty and reversed ranges", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  expect(() => buildTimelineRebuildBatches(date, date)).toThrow();
  expect(() => buildTimelineRebuildBatches(new Date(date.getTime() + 1), date))
    .toThrow();
});

Deno.test("sparse Timeline repair ranges stay sparse and merge adjacent days", () => {
  const batches = buildTimelineRebuildRangeBatches([
    {
      start: new Date("2026-08-21T00:00:00.000Z"),
      end: new Date("2026-08-23T00:00:00.000Z"),
    },
    {
      start: new Date("2023-08-10T00:00:00.000Z"),
      end: new Date("2023-08-11T00:00:00.000Z"),
    },
    {
      start: new Date("2026-08-10T00:00:00.000Z"),
      end: new Date("2026-08-11T00:00:00.000Z"),
    },
  ]);

  expect(batches).toHaveLength(3);
  expect(batches.map((batch) => batch.start.toISOString())).toEqual([
    "2023-08-10T00:00:00.000Z",
    "2026-08-10T00:00:00.000Z",
    "2026-08-21T00:00:00.000Z",
  ]);
  expect(batches.map((batch) => batch.batchIndex)).toEqual([0, 1, 2]);
});

Deno.test("Timeline mismatch planner returns only affected UTC days", () => {
  const counts = (audio_chunks: number, transcriptions: number) => ({
    audio_chunks,
    transcriptions,
  });
  const repairs = findTimelineRepairRanges([
    {
      start: new Date("2023-08-10T00:00:00.000Z"),
      counts: counts(0, 6),
    },
    {
      start: new Date("2026-08-21T00:00:00.000Z"),
      counts: counts(1_862, 77),
    },
    {
      start: new Date("2026-08-22T00:00:00.000Z"),
      counts: counts(3_822, 255),
    },
  ], [
    {
      start: new Date("2023-08-10T00:00:00.000Z"),
      counts: counts(0, 5),
    },
    {
      start: new Date("2026-08-21T00:00:00.000Z"),
      counts: counts(70, 4),
    },
  ]);

  expect(repairs).toHaveLength(2);
  expect(repairs[0]).toMatchObject({
    days: 1,
    differences: { audio_chunks: 0, transcriptions: -1 },
  });
  expect(repairs[1]).toMatchObject({
    days: 2,
    differences: { audio_chunks: -5_614, transcriptions: -328 },
  });
  expect(repairs[1].start.toISOString()).toBe("2026-08-21T00:00:00.000Z");
  expect(repairs[1].end.toISOString()).toBe("2026-08-23T00:00:00.000Z");
});

Deno.test("timeline campaign status keeps failures visible after the queue drains", () => {
  expect(timelineCampaignStatus({
    total: 3,
    active: 0,
    waiting: 0,
    delayed: 0,
    failed: 1,
    cancelled: 0,
    completed: 2,
  })).toBe("completed_with_errors");
  expect(timelineCampaignStatus({
    total: 3,
    active: 1,
    waiting: 1,
    delayed: 0,
    failed: 0,
    cancelled: 0,
    completed: 1,
  })).toBe("running");
});

Deno.test("timeline campaign preserves the terminal exact-verification result", () => {
  const drained = {
    active: 0,
    waiting: 0,
    delayed: 0,
    failed: 0,
    cancelled: 0,
    missingJobs: 0,
  };
  expect(deriveTimelineCampaignRecoveryStatus({
    ...drained,
    storedStatus: "completed",
  })).toBe("completed");
  expect(deriveTimelineCampaignRecoveryStatus({
    ...drained,
    storedStatus: "completed_with_errors",
  })).toBe("completed_with_errors");
  expect(deriveTimelineCampaignRecoveryStatus({
    ...drained,
    storedStatus: "running",
  })).toBe("verifying");
});

Deno.test("exact verification releases a drained campaign on mismatch", () => {
  expect(timelineVerificationOutcome("healthy")).toEqual({
    status: "completed",
    blockingReason: null,
  });
  expect(timelineVerificationOutcome("needs_attention")).toMatchObject({
    status: "completed_with_errors",
  });
});
