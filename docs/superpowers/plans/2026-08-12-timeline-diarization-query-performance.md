# Timeline Diarization Query Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Timeline diarization database work and payload size during
wheel/zoom while preserving live progress.

**Architecture:** Keep the existing resource endpoints and indexes. Extract pure
backend query builders so coverage can be verified as a covered scan and add a
Timeline-only list projection. Separate the immediate D3 render domain from a
padded, aligned, 300 ms debounced network domain shared by both diarization
tracks.

**Tech Stack:** Deno, TypeScript, MongoDB aggregation, React 19, TanStack Query
5, Vitest.

## Global Constraints

- Do not rewrite historical data or rebuild histogram collections.
- Preserve the full `speaker-segments/list` response for Transcript and
  Diarization Detail; compact projection is opt-in with `view: "timeline"`.
- Preserve unrelated working-tree changes and stage only task files.
- Verify live code only after confirming mounts, dev mode, `[READY]`, health,
  readiness, and the exact Timeline route.

---

### Task 1: Covered coverage aggregation and compact Timeline projection

**Files:**

- Create: `backend/app/lib/speakers/timeline-queries.ts`
- Create: `backend/app/lib/speakers/timeline-queries.test.ts`
- Modify: `backend/app/lib/speakers/resource.server.ts`

**Interfaces:**

- Produces:
  `buildDiarizationCoveragePipeline(start: Date, end: Date, bucketMs: number): Record<string, unknown>[]`.
- Produces: `TIMELINE_SPEAKER_SEGMENT_PROJECTION`, an inclusion projection
  without `embedding`.
- Extends list input with `view: "full" | "timeline"`, defaulting to `"full"`.

- [ ] **Step 1: Write the failing backend tests**

Assert that the first coverage `$project` contains `_id: 0`, and that the
Timeline projection contains only `_id`, `start`, `end`, `original_id`,
`original`, and `speakerIdentity`.

- [ ] **Step 2: Run tests and verify RED**

Run: `deno test -A app/lib/speakers/timeline-queries.test.ts`

Expected: FAIL because `timeline-queries.ts` does not exist.

- [ ] **Step 3: Implement the pure query builder and projection**

Move the existing aggregation stages into `buildDiarizationCoveragePipeline`,
add `_id: 0`, and export the Timeline projection constant.

- [ ] **Step 4: Wire the resource**

Use the builder for coverage. For list requests, pass the compact projection
only when `input.view === "timeline"`; retain the existing full-document
behavior otherwise.

- [ ] **Step 5: Verify GREEN and type-check**

Run:

```bash
deno test -A app/lib/speakers/timeline-queries.test.ts
deno check app/lib/speakers/resource.server.ts
```

Expected: tests and check pass.

### Task 2: Stable debounced viewport query windows

**Files:**

- Create: `frontend/src/lib/timelineQueryRange.ts`
- Create: `frontend/src/lib/timelineQueryRange.test.ts`
- Create: `frontend/src/hooks/useTimelineQueryRange.ts`
- Modify: `frontend/src/components/timeline/tracks/HistogramTrack.tsx`

**Interfaces:**

- Produces: `resolveTimelineQueryRange(visible, previous, alignmentMs)`
  returning `{ start: number; end: number; alignmentMs: number }`.
- Produces: `useTimelineQueryRange(start, end, alignmentMs, delayMs = 300)`
  returning debounced `Date` bounds.

- [ ] **Step 1: Write the failing range tests**

Assert that a new query window contains the full viewport, aligns both ends to
`alignmentMs`, pads by the smaller of 50% or two buckets on each side, and
returns the identical previous object for a small pan still contained by that
window.

- [ ] **Step 2: Run tests and verify RED**

Run: `deno task test run src/lib/timelineQueryRange.test.ts`

Expected: FAIL because `timelineQueryRange.ts` does not exist.

- [ ] **Step 3: Implement minimal range resolution**

Reuse `previous` only when its alignment matches and it contains the visible
interval. Otherwise pad by the smaller of half the visible duration or two
buckets on each side and floor/ceil to the alignment.

- [ ] **Step 4: Implement the debounce hook**

Initialize from the current viewport and update through
`resolveTimelineQueryRange` only after 300 ms without a viewport change.

- [ ] **Step 5: Wire both tracks**

Use the debounced query range in both query keys and request bodies. Pass
`view: "timeline"` for speaker segments. Keep the immediate rescaled D3 domain
for drawing, use previous data as placeholder data, and use a nonzero stale time
for the speaker track.

- [ ] **Step 6: Make coverage polling conditional**

Return `15_000` only when data contains a building run or a bucket with
`processing > 0`; otherwise return `false`.

- [ ] **Step 7: Verify GREEN and frontend checks**

Run:

```bash
deno task test run src/lib/timelineQueryRange.test.ts src/lib/diarizationCoverage.test.ts
deno check src/components/timeline/tracks/HistogramTrack.tsx src/hooks/useTimelineQueryRange.ts
```

Expected: tests and checks pass.

### Task 3: Live performance verification and scoped commit

**Files:**

- Modify only if verification exposes a regression in Task 1 or Task 2 files.

- [ ] **Step 1: Run focused backend and frontend checks together**

Confirm all Task 1 and Task 2 tests and checks remain green.

- [ ] **Step 2: Verify the Mongo execution plan**

Run `explain("executionStats")` for the user-supplied range and assert
`totalDocsExamined === 0` with the existing
`audio_chunks_diarization_coverage_v1` hint.

- [ ] **Step 3: Verify the live runtime boundary**

Confirm current-checkout bind mounts, `FRONTEND_MODE=dev`, `BACKEND_TASK=dev`,
backend `[READY]`, Compose health, `/health`, and `/readiness` before profiling
the route.

- [ ] **Step 4: Profile the in-app browser**

Reload the exact Timeline URL, perform eight wheel steps, and compare nginx
access logs. Success is one replacement coverage request after the gesture, no
per-event burst, and a compact Timeline speaker response.

- [ ] **Step 5: Review and commit only scoped files**

Run `git diff --check`, inspect `git status --short`, stage only
plan/spec/backend/frontend task files, and commit with
`perf: reduce Timeline diarization queries`.
