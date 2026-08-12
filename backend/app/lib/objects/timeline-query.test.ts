import { expect } from "@std/expect";

async function loadTimelineQueryModule() {
  const moduleUrl = new URL("./timeline-query.ts", import.meta.url).href;
  return await import(moduleUrl).catch(() => undefined);
}

Deno.test("Timeline object query matches before sorting and relationship expansion", async () => {
  const mod = await loadTimelineQueryModule();
  expect(mod).toBeDefined();

  const query = {
    timeRanges: {
      $elemMatch: {
        start: { $lt: new Date("2026-08-01T00:00:00.000Z") },
      },
    },
  };
  const pipeline = mod!.buildTimelineObjectsPipeline(
    query,
    { earliestStart: -1, duration: -1 },
    10_000,
  );

  expect(pipeline[0]).toEqual({ $match: query });
  expect(pipeline.find((stage: any) => stage.$limit)).toEqual({
    $limit: 5_001,
  });
  expect(pipeline.filter((stage: any) => stage.$lookup)).toHaveLength(2);
});

Deno.test("Timeline object query projects only fields needed by the track and cards", async () => {
  const mod = await loadTimelineQueryModule();
  expect(mod).toBeDefined();

  const pipeline = mod!.buildTimelineObjectsPipeline({}, undefined, 25);
  const projection = pipeline.find((stage: any) => stage.$project)?.$project;

  expect(projection).toEqual({
    _id: 1,
    name: 1,
    icon: 1,
    details: 1,
    summary: 1,
    timeRanges: 1,
    relationship: 1,
    isEvent: 1,
    isPerson: 1,
    isRelationship: 1,
    isPromise: 1,
    isPlace: 1,
    isOrganization: 1,
    isProduct: 1,
    isProject: 1,
    isAnimal: 1,
    isConcept: 1,
    isMedia: 1,
  });
});

Deno.test("Timeline relationship lookups return compact identity fields", async () => {
  const mod = await loadTimelineQueryModule();
  expect(mod).toBeDefined();

  const pipeline = mod!.buildTimelineObjectsPipeline({});
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
