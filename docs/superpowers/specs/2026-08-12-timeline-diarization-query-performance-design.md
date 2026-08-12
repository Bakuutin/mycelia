# Timeline Diarization Query Performance Design

## Problem

Timeline issues a new `speaker-segments` request for each wheel/zoom range. On
the observed 12-day range, eight wheel steps produced at least seven coverage
queries. The coverage aggregation examines 23,527 matching index keys but also
fetches 23,527 documents because `_id` remains in its projection. The speaker
identity request also returns embeddings and produced a 12.4 MB response even
though Timeline only draws segment position and identity state.

## Approved approach

Apply a bounded tactical fix without changing stored data or rebuilding
histograms:

1. Make coverage use a covered index scan by excluding `_id` from the first
   aggregation projection.
2. Project only Timeline-required segment fields from `diarizations`; never
   return embeddings from the list action.
3. Derive bucket-aligned query ranges padded by the smaller of half a viewport
   or two buckets, then debounce viewport changes by 300 ms. Small movement
   inside the padded range reuses the same React Query key and cache entry
   without doubling large speaker queries.
4. Keep the previous result visible while a replacement range loads.
5. Poll coverage every 15 seconds only while the returned data reports an active
   building run or processing bucket.

## Data flow

The SVG continues to render against the immediate D3 scale. Network inputs are
separate: the current visible domain is converted to a stable query window, then
debounced before it enters the query key. Returned segments and coverage buckets
may extend outside the viewport; SVG clipping naturally hides them.

The server keeps the existing endpoints and response shapes. Coverage uses the
existing `audio_chunks_diarization_coverage_v1` index. Speaker list results keep
`_id`, time bounds, original recording identifiers, and `speakerIdentity`, which
are sufficient for annotation projection and Timeline navigation.

## Error and freshness behavior

The existing click-to-retry error remains. A range change keeps prior marks
visible until the new request completes. Coverage remains fresh during active
processing but stops periodic database work for static ranges.

## Verification

- Unit tests assert stable padded ranges and viewport containment.
- Backend tests assert `_id: 0` in the coverage projection and the compact
  speaker list projection.
- Mongo `explain("executionStats")` must report `totalDocsExamined: 0` for the
  supplied range.
- In-app browser profiling must show one request after a wheel gesture rather
  than one per wheel event and a materially smaller speaker response.

## Out of scope

Materializing diarization state into `histogram_*`, historical data rewrites,
and changing diarization inference throughput are separate projects.
