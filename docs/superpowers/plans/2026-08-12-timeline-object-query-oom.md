# Timeline Object Query OOM Prevention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Timeline pan/zoom from creating concurrent unbounded object aggregates that can OOM MongoDB.

**Architecture:** Add a Timeline-specific object query contract that filters first, limits before relationship expansion, projects compact fields, and exposes truncation. Reuse the existing padded/aligned Timeline range hook on the frontend and guard the Zustand store against stale responses. Add the range index through the normal backend migration path.

**Tech Stack:** Deno, TypeScript, MongoDB 8, Zod, React 19, Zustand, Vitest, Docker Compose, in-app browser.

## Global Constraints

- Preserve the legacy `objects.list` array response for callers that do not request `view: "timeline"`.
- Clamp Timeline object results to at most 5,000 and use `maxTimeMS: 5_000`.
- Keep the previous successful Timeline objects visible while a replacement request is pending or fails.
- Do not reset or restart MongoDB/Redis as part of the application fix.
- Do not modify the user's unrelated `README.md` change.
- Use focused regression tests and verify live behavior through the in-app browser before merging to `sky-uat`.

---

### Task 1: Bounded, indexed Timeline object backend query

**Files:**
- Create: `backend/app/lib/objects/timeline-query.test.ts`
- Create: `backend/app/lib/objects/timeline-query.ts`
- Create: `backend/migrations/0043_timeline_object_range_index.ts`
- Modify: `backend/app/lib/objects/resource.server.ts:125-160`
- Modify: `backend/app/lib/objects/resource.server.ts:1747-1880`
- Modify: `backend/app/lib/objects/resource.test.ts`
- Modify: `backend/app/tests/migrations.test.ts`

**Interfaces:**
- Consumes: existing `objects.list` time-range filters and Mongo aggregate resource.
- Produces: `buildTimelineObjectsPipeline(query, sort, requestedLimit)`, `TIMELINE_OBJECT_LIMIT`, `TIMELINE_OBJECT_MAX_TIME_MS`, and Timeline response `{ objects: Object[]; truncated: boolean }`.

- [ ] **Step 1: Write failing pure pipeline tests**

Create tests that dynamically load `timeline-query.ts`, then assert hand-written pipeline invariants:

```ts
Deno.test("Timeline object query matches before expanding relationships", async () => {
  const moduleUrl = new URL("./timeline-query.ts", import.meta.url).href;
  const mod = await import(moduleUrl).catch(() => undefined);
  expect(mod).toBeDefined();
  const pipeline = mod!.buildTimelineObjectsPipeline(
    { timeRanges: { $elemMatch: { start: { $lt: new Date("2026-08-01") } } } },
    { earliestStart: -1, duration: -1 },
    10_000,
  );
  expect(pipeline[0].$match).toBeDefined();
  expect(pipeline.find((stage: any) => stage.$limit)?.$limit).toBe(5_001);
  expect(pipeline.filter((stage: any) => stage.$lookup)).toHaveLength(2);
  expect(pipeline.find((stage: any) => stage.$project)?.$project).toEqual({
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
  for (const stage of pipeline.filter((item: any) => item.$lookup)) {
    expect(stage.$lookup.pipeline).toEqual([
      { $project: { _id: 1, name: 1, icon: 1 } },
    ]);
  }
});
```

- [ ] **Step 2: Run the pure tests and verify RED**

Run:

```bash
cd backend
deno test -A app/lib/objects/timeline-query.test.ts
```

Expected: FAIL because `timeline-query.ts` does not exist.

- [ ] **Step 3: Implement the pure pipeline builder**

Create `timeline-query.ts` with:

```ts
export const TIMELINE_OBJECT_LIMIT = 5_000;
export const TIMELINE_OBJECT_MAX_TIME_MS = 5_000;

export function buildTimelineObjectsPipeline(
  query: Record<string, unknown>,
  sort: Record<string, number> = { earliestStart: -1, duration: -1 },
  requestedLimit = TIMELINE_OBJECT_LIMIT,
): Record<string, unknown>[] {
  const limit = Math.min(Math.max(1, requestedLimit), TIMELINE_OBJECT_LIMIT);
  return [
    { $match: query },
    {
      $addFields: {
        earliestStart: {
          $min: { $map: { input: "$timeRanges", as: "r", in: "$$r.start" } },
        },
        latestEnd: {
          $max: {
            $map: {
              input: "$timeRanges",
              as: "r",
              in: { $ifNull: ["$$r.end", "$$r.start"] },
            },
          },
        },
      },
    },
    { $addFields: { duration: { $subtract: ["$latestEnd", "$earliestStart"] } } },
    { $sort: sort },
    { $limit: limit + 1 },
    {
      $project: {
        _id: 1, name: 1, icon: 1, details: 1, summary: 1,
        timeRanges: 1, relationship: 1,
        isEvent: 1, isPerson: 1, isRelationship: 1, isPromise: 1,
        isPlace: 1, isOrganization: 1, isProduct: 1, isProject: 1,
        isAnimal: 1, isConcept: 1, isMedia: 1,
      },
    },
    {
      $lookup: {
        from: "objects",
        localField: "relationship.subject",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, name: 1, icon: 1 } }],
        as: "subjectObject",
      },
    },
    {
      $lookup: {
        from: "objects",
        localField: "relationship.object",
        foreignField: "_id",
        pipeline: [{ $project: { _id: 1, name: 1, icon: 1 } }],
        as: "objectObject",
      },
    },
    { $unwind: { path: "$subjectObject", preserveNullAndEmptyArrays: true } },
    { $unwind: { path: "$objectObject", preserveNullAndEmptyArrays: true } },
  ];
}
```

- [ ] **Step 4: Run the pure tests and verify GREEN**

Run:

```bash
cd backend
deno test -A app/lib/objects/timeline-query.test.ts
```

Expected: all pipeline tests PASS.

- [ ] **Step 5: Write failing resource-contract and migration tests**

Add an objects resource test that creates two matching objects, requests Timeline view with `options.limit: 1`, and asserts a non-array response containing one object and `truncated: true`. Assert a sentinel large field is not returned while `details`, relationship names, and icons remain available. Add a legacy request assertion that still returns an array.

Add a migration test:

```ts
Deno.test("migrations add the Timeline object start index", withFixtures(
  ["Mongo"],
  async ({ db }) => {
    await ensureAllCollectionsExist(db);
    expect(await db.collection("objects").indexExists(
      "timeline_objects_time_range_start",
    )).toBe(true);
  },
));
```

- [ ] **Step 6: Run focused resource/migration tests and verify RED**

Run:

```bash
cd backend
deno test -A app/lib/objects/resource.test.ts --filter "Timeline view"
deno test -A app/tests/migrations.test.ts --filter "Timeline object start index"
```

Expected: resource test FAILS because Timeline view is not supported; migration test FAILS because the named index does not exist.

- [ ] **Step 7: Wire Timeline view and add migration**

Add top-level optional `view: z.enum(["full", "timeline"]).optional()` to the list request schema. In the relationship list branch, select the new pipeline only for `view === "timeline"`, execute it with:

```ts
options: {
  allowDiskUse: true,
  maxTimeMS: TIMELINE_OBJECT_MAX_TIME_MS,
}
```

Remove the sentinel row at `limit`, return the first `limit` rows, and set `truncated` from whether the sentinel existed. Leave the old aggregate path unchanged for full view.

Create migration `0043_timeline_object_range_index.ts` using:

```ts
await ensureIndexExists(
  db,
  "objects",
  { "timeRanges.start": 1 },
  { name: "timeline_objects_time_range_start" },
);
```

The down migration drops only that named index if it exists.

- [ ] **Step 8: Run focused backend tests and checks**

Run:

```bash
cd backend
deno test -A app/lib/objects/timeline-query.test.ts
deno test -A app/lib/objects/resource.test.ts --filter "Timeline view"
deno test -A app/tests/migrations.test.ts --filter "Timeline object start index"
deno check app/lib/objects/timeline-query.ts app/lib/objects/resource.server.ts migrations/0043_timeline_object_range_index.ts
```

Expected: all focused tests and checks PASS.

- [ ] **Step 9: Commit backend fix**

```bash
git add backend/app/lib/objects/timeline-query.ts \
  backend/app/lib/objects/timeline-query.test.ts \
  backend/app/lib/objects/resource.server.ts \
  backend/app/lib/objects/resource.test.ts \
  backend/app/tests/migrations.test.ts \
  backend/migrations/0043_timeline_object_range_index.ts
git commit -m "perf: bound Timeline object queries"
```

### Task 2: Coalesce Timeline object requests and ignore stale responses

**Files:**
- Create: `frontend/src/modules/objects/useObjects.test.ts`
- Modify: `frontend/src/modules/objects/useObjects.ts`

**Interfaces:**
- Consumes: `useTimelineQueryRange(start, end, alignmentMs, 300)` and backend Timeline response `{ objects, truncated }`.
- Produces: store fields `truncated: boolean`, stable padded request ranges, and newest-request-wins response handling.

- [ ] **Step 1: Write failing store tests**

Mock only the external `callResource` boundary with two deferred promises. Start request A and request B, resolve B first, then A, and assert that the store still contains B's objects and range. Add a separate test that resolves a Timeline response and asserts `truncated` is stored. The tests must reset Zustand state between cases.

```ts
expect(useObjectsStore.getState().objects[0].name).toBe("newest");
expect(useObjectsStore.getState().currentRange).toEqual(rangeB);
expect(useObjectsStore.getState().truncated).toBe(true);
```

- [ ] **Step 2: Run store tests and verify RED**

Run:

```bash
cd frontend
deno run -A npm:vitest run src/modules/objects/useObjects.test.ts
```

Expected: FAIL because stale responses overwrite newer state and Timeline response metadata is unsupported.

- [ ] **Step 3: Implement stable range and newest-request-wins state**

Update `fetchObjects` to call:

```ts
callResource("objects", {
  action: "list",
  view: "timeline",
  options: {
    hasTimeRanges: true,
    includeRelationships: true,
    limit: 5_000,
    sort: { earliestStart: -1, duration: -1 },
    timeRangeFilter: { start: start.toISOString(), end: end.toISOString() },
  },
});
```

Use a monotonic request generation around success and error state updates. In `useObjects`, replace the local 150 ms timeout with:

```ts
const queryRange = useTimelineQueryRange(start, end, 5 * 60 * 1_000, 300);
useEffect(() => {
  void fetchForRange(queryRange.start, queryRange.end);
}, [fetchForRange, queryRange.start, queryRange.end]);
```

Do not clear `objects` on loading or error.

- [ ] **Step 4: Run frontend tests and checks**

Run:

```bash
cd frontend
deno run -A npm:vitest run \
  src/modules/objects/useObjects.test.ts \
  src/lib/timelineQueryRange.test.ts \
  src/modules/objects/index.test.ts
deno check src/modules/objects/useObjects.ts
```

Expected: focused tests and the changed-file check PASS.

- [ ] **Step 5: Commit frontend fix**

```bash
git add frontend/src/modules/objects/useObjects.ts \
  frontend/src/modules/objects/useObjects.test.ts
git commit -m "perf: coalesce Timeline object requests"
```

### Task 3: Live verification and UAT integration

**Files:**
- Read: `DEVELOPMENT.md`
- Verify: Docker bind mounts, logs, Mongo explain, and Timeline browser behavior.
- Integrate: commits from the isolated branch into `sky-uat`.

**Interfaces:**
- Consumes: the two implementation commits and migration `0043`.
- Produces: live evidence that the fix is loaded and a clean, intentional UAT merge/cherry-pick.

- [ ] **Step 1: Run complete focused verification**

```bash
git diff --check
cd backend && deno test -A app/lib/objects/timeline-query.test.ts
cd ../frontend && deno run -A npm:vitest run \
  src/modules/objects/useObjects.test.ts \
  src/lib/timelineQueryRange.test.ts \
  src/modules/objects/index.test.ts
```

- [ ] **Step 2: Transfer implementation commits to the bind-mounted UAT checkout**

From `~/repo/mycelia`, verify only the user's `README.md` is dirty, then cherry-pick the design, plan, backend, and frontend commits by explicit hashes. Do not stage or modify `README.md`.

- [ ] **Step 3: Verify runtime reload boundary**

Follow `DEVELOPMENT.md`: confirm backend/frontend mounts point to `~/repo/mycelia`, confirm `BACKEND_TASK=dev` and `FRONTEND_MODE=dev`, wait for `[READY]`, verify Compose health, then require fresh `/health=200` and `/readiness=200`. Recreate only the affected application service and restart nginx if source remains stale.

- [ ] **Step 4: Apply and verify migration through normal backend startup**

Confirm `0043_timeline_object_range_index.ts` appears in migration logs and `objects` has `timeline_objects_time_range_start`. Do not create a different manual index.

- [ ] **Step 5: Record representative explain evidence**

Run the exact Timeline time-range match with `explain("executionStats")` and record `winningPlan`, `totalDocsExamined`, `totalKeysExamined`, and execution time. Require an indexed initial match rather than the previous 206,217-document leading collection scan.

- [ ] **Step 6: Verify with the in-app browser**

Open the incident URL, clear request observations, perform a short repeated wheel pan/zoom sequence, and record:

- number of `objects` requests after the 300 ms debounce;
- response status and payload size;
- whether stale intermediate ranges continue requesting;
- console errors and visible Timeline error/loading state.

Require no Timeline `500`, no Mongo restart increase, and substantially smaller object payloads than 4.9-5.2 MB.

- [ ] **Step 7: Report UAT merge state**

Report implementation commit hashes, `sky-uat` commit hashes, focused test counts, explain metrics, browser request/payload evidence, and current Mongo/backend/frontend health. State separately whether anything was pushed; do not push unless explicitly requested.
