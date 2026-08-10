# Diarization routing controls, progress, and safe generation recovery

Date: 2026-08-10

## Objective

Make diarization operable from the Jobs page in the same place as STT and LLM routing. Operators must be able to enable or disable routes, assign exact numeric priorities, see which service a job actually used, and understand how much work remains. Failed versioned generations must be recoverable without reusing a terminal `runId`.

## Confirmed current failures

1. The saved remote profile is named `faeon-diar` and points to `http://100.119.163.116:8085`, but new diarization jobs are labelled `selfhost`. The generic enqueue snapshot first copies the primary LLM profile name. Diarization routing later replaces the profile ID and URL but does not replace `providerProfileName`.
2. The first generation job `6a79437d2233ed05182939ec` failed because the diarization capability may write and update `db/diarizations` but may not read it. Speaker-label reconciliation reads existing diarizations, producing HTTP 403.
3. That failure moved the generation run out of `building`. Generic `Run again` copied the same `runId`, so subsequent jobs failed with `A building diarization run must exist before processing`.
4. The default job limit is four sequences, while detailed progress is emitted only every fifth sequence. Later progress payloads also omit `total_chunks`, so the Jobs page cannot retain a percentage or calculate an ETA.

## Scope

This change covers:

- diarizator route controls on Jobs;
- enqueue-time diarizator provenance;
- diarization worker permissions;
- active-job progress and approximate ETA;
- generation-aware rerun behavior;
- focused automated and live-browser verification.

It does not activate a completed generation, delete failed generations, alter raw audio, perform the full identity backfill, or rewrite historical job provenance.

## Route controls on Jobs

The existing `External services & routing` section remains the operator surface. The diarizator card will render every environment and configured profile route with:

- an enabled switch;
- profile name and base URL;
- health state and latency;
- an integer priority input constrained to `1..100`;
- a per-route Save button;
- the explanation `Lower numbers are preferred for new jobs`;
- a link to Settings for adding, renaming, or deleting profiles.

The Jobs controls edit only routing fields. They do not start or stop a local or remote container.

Saving a remote route patches the matching entry in `diarizationProfiles.profiles`. Saving the environment route patches `includeEnvironment` and `environmentPriority`. Existing profiles and unrelated configuration fields must be preserved. The backend schema remains the final validator and prevents a configuration with no enabled route.

Enabling a route immediately requests a fresh health probe. Disabling a route does not probe it and updates the cached UI state to `disabled`. A mutation error leaves the previous configuration visible and shows an inline error; it must not optimistically claim that the change succeeded.

## Correct job provenance

When enqueue selects a healthy diarizator route, it must snapshot the selected route as one coherent object:

- `routingContext.providerProfileId`;
- `routingContext.providerProfileName`;
- `routingContext.sourceId`, using a diarization-specific prefix;
- `routingContext.resolvedAt`;
- `data.diarizationServerUrl`.

No diarization field may be inherited from LLM routing. Jobs list and Job Details continue to read the immutable snapshot through `getDiarizationJobRoute`.

Historical jobs are not rewritten. A pre-fix job that says `selfhost` remains an audit record of the previously stored snapshot. New jobs using the configured remote route must display `faeon-diar · http://100.119.163.116:8085`.

## Capability repair

The diarization worker capability gains `db/diarizations:read` in addition to its existing write and update permissions. This is the minimum permission required by overlap lookup and stable speaker-label reconciliation. No broader wildcard permission is introduced for that collection.

The capability test must assert the complete required policy set so a future policy cleanup cannot silently remove the read grant.

## Progress and ETA contract

The Python diarization job will emit a progress payload after counting and after every processed sequence. Every processing payload is a complete snapshot rather than a delta:

```text
stage
message
total_chunks
chunks_processed
chunks_remaining
sequences_processed
segments_created
errors
elapsed_seconds
chunks_per_second
eta_seconds
```

`total_chunks` is the pending work in the requested range at the start of the current bounded job. `chunks_remaining` is `max(total_chunks - chunks_processed, 0)` for the same range. `eta_seconds` is present only after at least one chunk has completed and elapsed time is positive. Errors and zero-progress sequences remain visible but do not create a fabricated rate.

The estimate is explicitly approximate. It uses the observed average rate of the active job and may change when audio density, sequence length, server load, or a chained continuation changes. Each continuation is a separate bounded job and starts with a newly counted, lower remaining backlog. The UI does not claim a stable run-wide percentage across separate jobs.

## Progress presentation

For an active diarization row, Jobs shows:

- stage badge;
- `N / T chunks this job` when total is known;
- a progress bar based on `chunks_processed / total_chunks`;
- `R chunks remaining in range`;
- sequences, segments, and errors;
- observed throughput;
- `About … remaining` when ETA is available;
- `ETA available after the first completed sequence` otherwise.

The same data is shown on Job Details. Completed jobs retain their existing final result metrics. Unknown totals never render as zero or as a misleading 100% bar.

## Safe generation recovery

Generic jobs retain the one-click `Run again` action. A job with `type=diarization` and `mode=build_generation` uses a separate `Start new generation` action.

That action:

1. reads current diarizator health and requires a healthy selected route with runtime fingerprints;
2. reads existing diarization runs;
3. creates a fresh time-based `runId` and the next generation number;
4. creates a new `building` run for the original start/end range, replacing the currently active run rather than the failed run;
5. enqueues a new `build_generation` job with the fresh `runId`;
6. navigates to the newly created job and reports success or a concrete error inline.

It never changes a failed run back to `building`, reuses its ID, deletes it, or activates the replacement automatically.

As defense in depth, attempting to enqueue a `build_generation` job whose run is not `building` must fail before the network worker starts, with an operator-facing message instructing the caller to start a new generation. This avoids spending worker startup time on a known-invalid request.

## Data flow

```text
Jobs route control
  -> config patch
  -> schema validation
  -> forced health refresh when enabled
  -> Jobs route card

Generation launch
  -> health fingerprint
  -> create fresh diarization_run(building)
  -> enqueue with coherent diarizator snapshot
  -> Python worker
  -> complete progress frames
  -> BullMQ/Mongo job projection
  -> Jobs and Job Details
```

## Error handling

- No enabled route: reject the config patch and retain the previous UI state.
- Enabled but unhealthy route: show its health failure; enqueue skips it by priority.
- No healthy routes: do not enqueue a diarization-dependent job.
- Missing diarization read permission: covered by capability policy test.
- Terminal generation run: reject before worker launch and offer `Start new generation`.
- Progress total unavailable: show processed counters without percentage or ETA.
- Worker makes no progress: preserve failed job/run state and do not self-chain.

## Test strategy

### Backend and queue

- Selecting `faeon-diar` snapshots its ID, exact name, URL, source, and resolved timestamp.
- A primary LLM profile named `selfhost` cannot leak into diarization provenance.
- Route enable/disable and numeric priority patches preserve all unrelated profiles and fields.
- Disabling the final available route is rejected.
- A terminal generation run is rejected before Python worker execution.
- A fresh generation action creates a distinct building run and enqueues that new ID.

### Worker

- Capability includes `db/diarizations:read` without widening other permissions.
- Counting emits a total.
- Every completed sequence emits a full progress snapshot.
- Remaining count, rate, and ETA are calculated correctly.
- Zero completed chunks omit ETA.
- The final result still provides `processed`, `hasMore`, cursor, errors, and coverage required by chaining.

### Frontend

- Diarizator rows render switches, exact priority values, Save state, health, and latency.
- Saving a route patches the correct remote or environment fields.
- Active progress renders counts, bar, remaining work, throughput, and ETA fallback.
- A normal failed job shows `Run again`; a failed generation shows `Start new generation`.
- Job route labels prefer the coherent diarization snapshot.

### Live verification

- Verify backend/frontend bind mounts and effective runtime modes per `DEVELOPMENT.md`.
- Rebuild/recreate only the affected production-mode application services and restart nginx.
- Wait for backend `[READY]`, healthy containers, `/health=200`, and `/readiness=200`.
- In Jobs, confirm local/environment remains disabled and `faeon-diar` is enabled with numeric priority.
- Launch a bounded seven-day generation against the remote route.
- Confirm the new job shows `faeon-diar`, emits progress before five sequences, and shows remaining work/ETA after its first successful sequence.
- Confirm the new run stays isolated and is not activated automatically.

## Acceptance criteria

- New remote diarization jobs never inherit the LLM provider name.
- The confirmed `db/diarizations:read` 403 is eliminated by the narrow policy grant.
- Generic rerun cannot reuse a failed or otherwise terminal generation run.
- Jobs can enable/disable every diarizator route and save exact priority `1..100`.
- Active diarization jobs update after every sequence and preserve totals.
- Remaining work is always numeric when count succeeds; ETA is shown only when supported by observed progress.
- Failed and superseded runs remain auditable, and no activation or purge occurs implicitly.
