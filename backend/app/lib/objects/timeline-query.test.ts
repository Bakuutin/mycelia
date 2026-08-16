import { expect } from "@std/expect";
import {
  buildTimelineObjectsPipeline,
  TIMELINE_OBJECT_PROJECTION,
} from "./timeline-query.ts";

Deno.test("Timeline object query matches before sorting and relationship expansion", () => {
  const query = {
    timeRanges: {
      $elemMatch: {
        start: { $lt: new Date("2026-08-01T00:00:00.000Z") },
      },
    },
  };
  const pipeline = buildTimelineObjectsPipeline(
    query,
    { earliestStart: -1, duration: -1 },
    10_000,
  );

  expect(pipeline[0]).toEqual({ $match: query });
  expect(pipeline[1]).toEqual({
    $limit: 5_001,
  });
  expect(pipeline.findIndex((stage: any) => stage.$limit)).toBeLessThan(
    pipeline.findIndex((stage: any) => stage.$addFields),
  );
  expect(pipeline.findIndex((stage: any) => stage.$limit)).toBeLessThan(
    pipeline.findIndex((stage: any) => stage.$sort),
  );
  expect(pipeline.filter((stage: any) => stage.$lookup)).toHaveLength(2);
});

Deno.test("Timeline object query projects only fields needed by the track and cards", () => {
  const pipeline = buildTimelineObjectsPipeline({}, undefined, 25);
  const projection = pipeline.find((stage: any) => stage.$project)?.$project;

  expect(projection).toEqual(TIMELINE_OBJECT_PROJECTION);
});

Deno.test("Timeline relationship lookups return compact identity fields", () => {
  const pipeline = buildTimelineObjectsPipeline({});
  const lookups = pipeline
    .filter((stage: any) => stage.$lookup)
    .map((stage: any) => stage.$lookup);

  expect(lookups.map((lookup: any) => lookup.as)).toEqual([
    "subjectObject",
    "objectObject",
  ]);
  for (const lookup of lookups) {
    expect(lookup.pipeline).toEqual([
      { $project: { _id: 1, name: 1, icon: 1 } },
    ]);
  }
});
