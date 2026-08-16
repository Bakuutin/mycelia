import { describe, expect, it } from "vitest";
import {
  shouldLoadTimelineObjectDetail,
  timelineObjectLimit,
  timelineSpeakerLimit,
} from "./timelineDetail";

const DAY_MS = 24 * 60 * 60 * 1_000;

describe("Timeline detail budgets", () => {
  it("loads less individual detail for a wide range", () => {
    expect(timelineObjectLimit(16 * DAY_MS, 1_000)).toBe(600);
    expect(timelineSpeakerLimit(16 * DAY_MS, 1_000)).toBe(750);
    expect(timelineObjectLimit(60 * 60 * 1_000, 1_000)).toBe(3_000);
    expect(timelineSpeakerLimit(60 * 60 * 1_000, 1_000)).toBe(5_000);
  });

  it("scales the budget with available pixels and keeps hard bounds", () => {
    expect(timelineObjectLimit(16 * DAY_MS, 2_000)).toBe(1_200);
    expect(timelineSpeakerLimit(365 * DAY_MS, 100)).toBe(250);
    expect(timelineSpeakerLimit(1_000, 10_000)).toBe(5_000);
  });

  it("defers individual objects when multiple minutes collapse into one pixel", () => {
    expect(shouldLoadTimelineObjectDetail(16 * DAY_MS, 1_000)).toBe(false);
    expect(shouldLoadTimelineObjectDetail(6 * DAY_MS, 1_000)).toBe(true);
  });
});
