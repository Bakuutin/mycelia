# Timeline Object Query OOM Prevention Design

## Problem

Timeline scrolling and zooming can enqueue many overlapping `objects.list`
requests. The current frontend keys work to the exact viewport, waits only
150 ms, and cannot reuse an already loaded surrounding range. Requests that
have started are allowed to finish even after the viewport changes.

The backend relationship query adds fields before filtering, performs two
full relationship lookups, sorts the complete result, and returns full object
documents without a Timeline-specific limit. During the 2026-08-12 incident,
MongoDB scanned 206,217 object documents for individual requests and returned
responses of roughly 4.9-5.2 MB. Several requests overlapped while the visible
range expanded toward one year. Docker recorded MongoDB OOM events at
01:12:35Z and 01:12:59Z; both processes exited with code 137.

## Goals

- Keep ordinary pan and scroll operations inside a reusable query window.
- Prevent intermediate viewport positions from creating concurrent heavy
  object aggregates.
- Make the Timeline object query filter early and return only fields needed by
  the Timeline renderer and selected-object cards.
- Bound query time and result count so one browser cannot exhaust MongoDB.
- Preserve the existing Timeline object rendering and relationship labels.
- Verify the behavior through focused unit tests, Mongo explain evidence, and
  the in-app browser.

## Non-goals

- Resetting MongoDB, Redis, or historical jobs.
- Changing general-purpose object list/search behavior for other pages.
- Implementing a new pre-aggregated object histogram.
- Treating a smaller WiredTiger cache as the primary fix.

## Considered Approaches

### 1. Timeline-specific bounded query on both layers (selected)

Reuse a padded and aligned frontend range, debounce viewport changes for
300 ms, and add a Timeline-specific backend view with an early `$match`, a
compact projection, minimal lookups, a 5,000-object limit, and a query timeout.
This removes redundant requests and bounds the remaining work without hiding
the object track during normal use.

### 2. Reduce WiredTiger cache only

Reducing the cache from its current automatic 1.5 GiB value would leave more
headroom under the 4 GiB container limit, but it would not remove concurrent
collection scans, large responses, or unnecessary lookups. It is useful only
as defense in depth after query pressure is fixed.

### 3. Disable objects at wide zoom levels

This provides the strongest immediate load bound, but makes the Timeline less
useful. The selected design instead returns a bounded subset and exposes that
the result was truncated. A future aggregated overview can replace truncation
if wide-range object density needs to be represented precisely.

## Frontend Design

`useObjects` will derive a stable query range from the viewport using the same
range helper already used by the diarization tracks. The range is padded and
aligned so small pans remain within cached data. Viewport changes are debounced
for 300 ms. The store will ignore stale responses by assigning each request a
monotonic generation and accepting only the newest generation.

The request will use an explicit Timeline view and a limit of 5,000. The store
will retain the previous successful objects while a replacement range loads,
avoiding a blank track during navigation. It will also retain response metadata
indicating whether the result was truncated.

The first version will not depend on HTTP abort propagation to cancel MongoDB
operations. Stale-response suppression protects UI correctness; stable ranges,
debouncing, and backend limits protect the database.

## Backend Design

The existing `objects.list` action will gain an optional `view: "timeline"`
mode. General-purpose callers keep the current behavior.

For Timeline mode, the relationship pipeline will:

1. Apply the time-range `$match` as the first stage.
2. Sort matched objects by their computed Timeline ordering.
3. Limit results to at most 5,000 before relationship expansion where semantic
   ordering allows it.
4. Project only Timeline fields: identity, name, icon, details/summary,
   category flags, relationship routing, and time ranges.
5. Perform relationship lookups with lookup pipelines that project only
   `_id`, `name`, and `icon`.
6. Execute with a bounded `maxTimeMS` and `allowDiskUse`.

The response will be `{ objects, truncated }` in Timeline mode. The limit is
clamped server-side even if a client requests a larger value. Existing list
responses remain arrays for compatibility.

## Index

The query requires an index beginning with `timeRanges.start`. Index creation
will use the repository's idempotent index/migration mechanism and a stable
name. The implementation must verify with `explain("executionStats")` that the
Timeline query no longer starts with a collection scan. Because open-ended
ranges include missing `end`, the first optimization target is selective start
bounds; compound end-field behavior will be accepted only if explain evidence
shows an improvement.

## Wide-range and Error Behavior

- Backend clamps the Timeline result limit to 5,000 and reports `truncated`.
- Mongo timeout errors remain non-retryable at the request layer; repeated
  automatic retries would amplify pressure.
- The frontend keeps the last successful objects and displays a non-blocking
  truncation/error state instead of clearing the track.
- Connection errors during a Mongo restart are reported normally; no automatic
  database or queue reset is introduced.

## Testing and Verification

- Frontend unit tests prove aligned padded ranges are reused, 300 ms debounce
  coalesces viewport updates, and a stale response cannot replace newer data.
- Backend tests prove Timeline mode clamps the limit, constructs an early
  `$match`, uses compact relationship projections, applies timeout options, and
  preserves the legacy list contract.
- Mongo explain verification records examined keys/documents and confirms the
  absence of the former leading collection scan.
- In-app browser verification uses the incident URL, performs repeated wheel
  pan/zoom actions, counts `objects` requests, records payload sizes/statuses,
  and checks the console.
- Runtime verification follows `DEVELOPMENT.md`: confirm bind mounts and dev
  mode, wait for backend `[READY]`, verify Compose health, then check `/health`
  and `/readiness` separately.

## Success Criteria

- A short sequence of Timeline wheel events produces at most one replacement
  object request after the debounce window when the viewport leaves the loaded
  query range.
- Object responses are substantially smaller than the observed 4.9-5.2 MB.
- The backend query is bounded by 5,000 results and a finite `maxTimeMS`.
- Explain evidence shows an indexed initial match rather than a full collection
  scan for a representative Timeline range.
- The incident URL renders without object/diarization 500 errors while MongoDB,
  backend, and frontend remain healthy.
