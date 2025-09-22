## Crossfilter migration for timeline summary buckets (5m, 1w)

This guide shows how to migrate Mycelia's timeline summary buckets to Crossfilter for fast, interactive aggregations (e.g., count per 5 minutes or per week) with range filters. It builds on the scaffold in `app/modules/ranges/index.ts`.

### Why Crossfilter
- **Incremental indexing**: Add items once, build dimensions/groups once, filter interactively.
- **Real‑time filtering**: `dimension.filterRange([start, end])` instantly updates group results.
- **Efficient aggregation**: `group().reduceSum(...)` or custom reducers for counts/sums/averages.

Reference: Crossfilter API `dimensions`, `groups`, `reduce`, `filterRange` in the official docs (`https://github.com/crossfilter/crossfilter/wiki/API-Reference`).

---

## Data model assumptions

- Each event has a numeric `timestamp` in milliseconds (Unix epoch ms).
- Optional metrics to aggregate (e.g., `durationMs`, `bytes`, etc.).

Example item shape:
```ts
type TimelineItem = {
  id: string
  timestamp: number
  durationMs?: number
}
```

---

## Bucketing strategy

Bucket keys are computed by flooring timestamps to a bucket size in milliseconds:

```ts
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const FIVE_MINUTES = 5 * MINUTE
const ONE_WEEK = WEEK

function toBucketStart(timestampMs: number, bucketMs: number): number {
  return Math.floor(timestampMs / bucketMs) * bucketMs
}
```

- **5 minute bucket**: `bucketMs = FIVE_MINUTES`
- **1 week bucket**: `bucketMs = ONE_WEEK`

The bucket key is a number (ms). Convert to `Date` in the UI as needed.

---

## Match server histogram binning

The server builds histograms in `app/services/timeline.server.ts` using the same floor-to-boundary strategy via `$subtract` and `$mod` over millisecond timestamps. Keep the client Crossfilter bucketing identical to avoid off-by-one mismatches.

Server-side grouping to `binStart`:
```104:121:app/services/timeline.server.ts
      {
        $group: {
          _id: {
            $toDate: {
              $subtract: [
                { $toLong: "$start" },
                { $mod: [{ $toLong: "$start" }, binSize] },
              ],
            },
          },
          ...(collectionConfig.count && { count: { $sum: 1 } }),
          ...(collectionConfig.aggregations &&
            collectionConfig.aggregations.reduce((acc, { key, operation }) => ({
              ...acc,
              [key]: operation,
            }), {})),
        },
      },
```

Resolutions are defined as:
```10:17:app/services/timeline.server.ts
export type Resolution = "5min" | "1hour" | "1day" | "1week";

const RESOLUTION_TO_MS: Record<Resolution, number> = {
  "5min": ms("5m"),
  "1hour": ms("1h"),
  "1day": ms("1d"),
  "1week": ms("1w"),
};
```

Client Crossfilter should derive `bucketMs` from the same mapping. If possible, centralize the mapping in a shared module to prevent drift.

---

## Minimal Crossfilter setup

In `app/modules/ranges/index.ts`, a `crossfilter` ref already exists. Expand it to expose a reusable bucketed dimension/group.

```ts
import crossfilter from 'npm:crossfilter2'
import { useMemo, useRef } from 'react'

export type BucketSummary = {
  count: number
  totalDurationMs: number
}

export function useBucketedTimeline(items: { id: string; timestamp: number; durationMs?: number }[], bucketMs: number) {
  const cfRef = useRef(crossfilter([]))

  useMemo(() => {
    cfRef.current.remove()
    cfRef.current.add(items)
  }, [items])

  const dim = useMemo(() => {
    return cfRef.current.dimension((d: any) => toBucketStart(d.timestamp, bucketMs))
    // dispose when bucketMs changes or component unmounts as needed
  }, [bucketMs])

  const group = useMemo(() => {
    const add = (p: BucketSummary, v: any) => {
      p.count += 1
      p.totalDurationMs += v.durationMs ?? 0
      return p
    }
    const remove = (p: BucketSummary, v: any) => {
      p.count -= 1
      p.totalDurationMs -= v.durationMs ?? 0
      return p
    }
    const init = (): BucketSummary => ({ count: 0, totalDurationMs: 0 })
    return dim.group().reduce(add, remove, init)
  }, [dim])

  return { cf: cfRef.current, dim, group }
}
```

Notes:
- Use `npm:crossfilter2` import form to match Mycelia's npm import convention.
- Recreate the dimension when `bucketMs` changes; dispose old `dim`/`group` if you maintain multiple.

---

## Filtering by visible timeline range

Integrate with the timeline range store (`app/stores/timelineRange.ts`) by applying a range filter on the dimension keyed by the raw timestamp (not the bucket key) or by filtering the bucketed dimension directly.

Option A: Dedicated timestamp dimension for range filtering plus a separate bucketed dimension for grouping:

```ts
const tsDim = useMemo(() => cf.dimension((d: any) => d.timestamp), [])
// when range changes
tsDim.filterRange([visibleStartMs, visibleEndMs])

// read results from the bucketed group (already constrained by tsDim filter)
const buckets = group.all() // [{ key: bucketStartMs, value: { count, totalDurationMs } }, ...]
```

Option B: Filter directly on the bucketed dimension using bucketed bounds:

```ts
const startKey = toBucketStart(visibleStartMs, bucketMs)
const endKey = toBucketStart(visibleEndMs, bucketMs) + bucketMs
dim.filterRange([startKey, endKey])
const buckets = group.all()
```

Option A provides higher fidelity selection when zooming; Option B is simpler and often sufficient for coarse summaries.

---

## Align client queries with server fetch window

The server widens the fetch window around the requested `[start, end]` to include neighboring buckets, which improves continuity in charts during zoom/pan:
```320:347:app/services/timeline.server.ts
  const binSize = RESOLUTION_TO_MS[resolution];
  const queryStart = new Date(startDate.getTime() - duration - binSize);
  const queryEnd = new Date(endDate.getTime() + duration + binSize);

  const histogramData = await mongo({
    action: "find",
    collection: `histogram_${resolution}`,
    query: {
      start: { $gte: queryStart, $lt: queryEnd },
    },
    options: { sort: { start: 1 } },
  }) as any[];
```

When mirroring this with Crossfilter on the client, consider adding a small margin to filters for smoother transitions, then clip in the view layer.

---

## Getting results for charts and UI

```ts
const rows = group.all() // sorted by key ascending
// Convert to UI-friendly structure
const series = rows.map(({ key, value }) => ({
  bucketStartMs: key,
  count: value.count,
  totalDurationMs: value.totalDurationMs,
}))
```

For top/bottom queries:
```ts
group.top(50)     // highest-value buckets by reducer value
group.bottom(50)  // lowest-value buckets
```

For simple counts only:
```ts
const countGroup = dim.group() // implicit count reducer
countGroup.all()
```

---

## Switching bucket resolutions (5m ↔ 1w)

Treat bucket size as state derived from zoom level or a selector.

```ts
const bucketMs = mode === '5m' ? FIVE_MINUTES : ONE_WEEK
const { cf, dim, group } = useBucketedTimeline(items, bucketMs)
```

When `bucketMs` changes:
- Recreate the bucketed dimension/group.
- Keep the timestamp dimension (if using Option A) to preserve range filters across bucket changes.

---

## Incremental updates

- Adding new items: `cf.add(newItems)`; group results update automatically.
- Removing items: filter by `id` dimension then `cf.remove()`, or reconstruct the index when deletions are rare.
- Avoid re-instantiating Crossfilter on every render; keep it in a ref.

```ts
const idDim = useMemo(() => cf.dimension((d: any) => d.id), [])
function removeByIds(ids: string[]) {
  idDim.filterFunction((id: string) => ids.includes(id))
  cf.remove()
  idDim.filterAll()
}
```

---

## Performance tips

- Prefer one persistent Crossfilter instance; add/remove as data changes.
- Use a separate timestamp dimension for range filters to avoid rebuilding groups when zooming.
- Keep reducers lean; use `reduceSum` where possible:
```ts
const countGroup = dim.group()
const durationGroup = dim.group().reduceSum((d: any) => d.durationMs ?? 0)
```
- Coerce all timestamps to numbers; avoid `Date` objects inside dimensions.
- Pre-bucket at ingestion for very large datasets if bucket size is fixed.

---

## Wiring into Mycelia components

1) Create a small ranges module API in `app/modules/ranges/index.ts`:
```ts
export function useSummaryBuckets(items: TimelineItem[], bucket: '5m' | '1w', visible?: { startMs: number; endMs: number }) {
  const bucketMs = bucket === '5m' ? FIVE_MINUTES : ONE_WEEK
  const { cf, dim, group } = useBucketedTimeline(items, bucketMs)
  if (visible) dim.filterRange([toBucketStart(visible.startMs, bucketMs), toBucketStart(visible.endMs, bucketMs) + bucketMs])
  return group.all()
}
```

2) Use it from charts (e.g., `TimelineItems.tsx`) to render bar heights by `value.count` and x-position by `key`.

3) Keep the visible range in `timelineRange` store; when it changes, update the filter on the appropriate dimension.

---

## Validation checklist

- Items load once into Crossfilter and remain stable across renders.
- Switching 5m/1w updates buckets without reloading all data.
- Zooming or panning applies `filterRange` and updates visible buckets.
- Group results power charts without additional client-side scans.

---

## Troubleshooting

- Empty buckets: Crossfilter omits buckets with zero count. Fill gaps in the view layer by generating a full key range and merging.
- Wrong bucket boundaries: Ensure `toBucketStart` uses millisecond timestamps and correct `bucketMs`.
- Stale results after filter: Call `group.all()` after updating filters; avoid caching results across filter changes.

---

## Next steps

- Flesh out `app/modules/ranges/index.ts` with the `useBucketedTimeline` and `useSummaryBuckets` exports above.
- Replace ad-hoc scans in data hooks (e.g., audio summaries) with Crossfilter dimensions/groups.
- Add tests that validate counts per bucket for both 5m and 1w resolutions and for filtered ranges.


