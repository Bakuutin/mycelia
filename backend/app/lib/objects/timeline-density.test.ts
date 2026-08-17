import { expect } from "@std/expect";
import {
  computeObjectDensityBuckets,
  filterObjectDensityBucket,
  getTimelineObjectCategory,
  objectDensityBucketStart,
  selectObjectDensityResolution,
} from "./timeline-density.ts";
import { resolveObjectDensityQuery } from "./timeline-density.server.ts";

Deno.test("Timeline object density uses the existing single-category precedence", () => {
  expect(getTimelineObjectCategory({ isPerson: true, isEvent: true })).toBe(
    "person",
  );
  expect(
    getTimelineObjectCategory({
      isPromise: true,
      isRelationship: true,
    }),
  ).toBe("promise");
  expect(getTimelineObjectCategory({ isMedia: true })).toBe("media");
  expect(getTimelineObjectCategory({})).toBe("other");
});

Deno.test("Timeline object density counts interval starts rather than distinct objects", () => {
  const calculatedAt = new Date("2026-08-18T12:00:00.000Z");
  const buckets = computeObjectDensityBuckets(
    [
      {
        isPerson: true,
        isEvent: true,
        timeRanges: [
          { start: new Date("2026-08-18T01:05:00.000Z") },
          { start: "2026-08-18T01:55:00.000Z" },
        ],
      },
      {
        isEvent: true,
        timeRanges: [{ start: new Date("2026-08-18T02:00:00.000Z") }],
      },
      {
        isEvent: true,
        timeRanges: [{ start: new Date("2026-08-19T00:00:00.000Z") }],
      },
    ],
    new Date("2026-08-18T00:00:00.000Z"),
    new Date("2026-08-19T00:00:00.000Z"),
    "1hour",
    calculatedAt,
  );

  expect(buckets).toHaveLength(2);
  expect(buckets[0]).toEqual({
    resolution: "1hour",
    start: new Date("2026-08-18T01:00:00.000Z"),
    total: 2,
    byCategory: { person: 2 },
    stale: false,
    calculatedAt,
  });
  expect(buckets[1].total).toBe(1);
  expect(buckets[1].byCategory).toEqual({ event: 1 });
});

Deno.test("Density filtering recomputes totals from visible categories", () => {
  const filtered = filterObjectDensityBucket(
    {
      resolution: "1day",
      start: new Date("2026-08-18T00:00:00.000Z"),
      total: 9,
      byCategory: { person: 4, event: 3, other: 2 },
      stale: true,
      calculatedAt: new Date("2026-08-18T01:00:00.000Z"),
    },
    ["event", "other"],
  );
  expect(filtered.total).toBe(5);
  expect(filtered.byCategory).toEqual({ event: 3, other: 2 });
  expect(filtered.stale).toBe(true);
});

Deno.test("Density query coarsens wide requests and aligns bucket boundaries", () => {
  const resolved = resolveObjectDensityQuery({
    start: "2026-01-01T00:12:00.000Z",
    end: "2026-05-01T00:01:00.000Z",
    resolution: "1hour",
    categories: ["person", "event"],
  });

  expect(resolved.resolution).toBe("1day");
  expect(resolved.start).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  expect(resolved.end).toEqual(new Date("2026-05-02T00:00:00.000Z"));
  expect(resolved.categories).toEqual(["person", "event"]);
  expect(
    objectDensityBucketStart(
      new Date("2026-08-18T12:34:56.000Z"),
      "1hour",
    ),
  ).toEqual(new Date("2026-08-18T12:00:00.000Z"));
});

Deno.test("Density resolution remains bounded at every supported scale", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  expect(
    selectObjectDensityResolution(
      start,
      new Date("2026-02-01T00:00:00.000Z"),
    ),
  ).toBe("1hour");
  expect(
    selectObjectDensityResolution(
      start,
      new Date("2030-01-01T00:00:00.000Z"),
    ),
  ).toBe("1day");
  expect(
    selectObjectDensityResolution(
      start,
      new Date("2050-01-01T00:00:00.000Z"),
    ),
  ).toBe("1week");
});
