import { expect } from "@std/expect";
import {
  buildTimelineRebuildBatches,
  timelineCampaignStatus,
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
