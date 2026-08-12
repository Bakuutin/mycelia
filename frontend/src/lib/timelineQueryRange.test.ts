import { describe, expect, it } from "vitest";
import { resolveTimelineQueryRange } from "./timelineQueryRange";

describe("Timeline query range", () => {
  it("caps viewport padding at two buckets and aligns both bounds", () => {
    expect(resolveTimelineQueryRange(
      { start: 10_250, end: 20_250 },
      undefined,
      1_000,
    )).toEqual({
      start: 8_000,
      end: 23_000,
      alignmentMs: 1_000,
    });
  });

  it("reuses the previous query key while a small pan stays covered", () => {
    const previous = {
      start: 5_000,
      end: 26_000,
      alignmentMs: 1_000,
    };

    expect(resolveTimelineQueryRange(
      { start: 12_000, end: 22_000 },
      previous,
      1_000,
    )).toBe(previous);
  });

  it("recomputes the query range when the bucket alignment changes", () => {
    const previous = {
      start: 5_000,
      end: 26_000,
      alignmentMs: 1_000,
    };

    expect(resolveTimelineQueryRange(
      { start: 12_000, end: 22_000 },
      previous,
      5_000,
    )).toEqual({
      start: 5_000,
      end: 30_000,
      alignmentMs: 5_000,
    });
  });
});
