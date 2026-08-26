import { describe, expect, it } from "vitest";
import { combineTimelineDataRanges } from "./timelineRangeBounds";

describe("combineTimelineDataRanges", () => {
  it("includes photos outside the Object time range", () => {
    expect(combineTimelineDataRanges([
      {
        start: "2026-08-10T00:00:00.000Z",
        end: "2026-08-20T00:00:00.000Z",
      },
      {
        start: "2024-01-02T03:00:00.000Z",
        end: "2026-08-25T09:00:00.000Z",
      },
    ])).toEqual({
      start: new Date("2024-01-02T03:00:00.000Z"),
      end: new Date("2026-08-25T09:00:00.000Z"),
    });
  });

  it("ignores unavailable or invalid sources", () => {
    expect(combineTimelineDataRanges([
      { start: null, end: null },
      {
        start: "invalid",
        end: "2026-08-25T09:00:00.000Z",
      },
      {
        start: "2026-08-24T09:00:00.000Z",
        end: "2026-08-25T09:00:00.000Z",
      },
    ])).toEqual({
      start: new Date("2026-08-24T09:00:00.000Z"),
      end: new Date("2026-08-25T09:00:00.000Z"),
    });
    expect(combineTimelineDataRanges([])).toBeUndefined();
  });
});
