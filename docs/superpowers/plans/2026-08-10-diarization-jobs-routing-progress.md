# Diarization Jobs Routing and Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make remote diarization complete without capability failures, expose numeric route controls on Jobs, preserve exact diarizator provenance, report remaining work and ETA, and recover failed generations with a fresh run.

**Architecture:** Keep route configuration in the existing server config and health resource. Add pure helpers for route snapshot/config updates and progress presentation, while the queue and Python worker remain authoritative for execution state. Treat versioned generation recovery as run creation, never as retrying a terminal run ID.

**Tech Stack:** Deno/TypeScript backend workers, BullMQ, MongoDB, Python 3.12/Pydantic worker service, React/TypeScript, TanStack Query, Vitest, Pytest, Docker Compose.

## Global Constraints

- Route priority is an integer from `1` through `100`; lower values are preferred.
- Jobs route controls never start or stop a container.
- Historical job routing snapshots are not rewritten.
- A failed, ready, active, or superseded run is never changed back to `building`.
- ETA is approximate and appears only after measurable successful progress.
- No generation is activated or purged automatically.
- Follow `DEVELOPMENT.md` readiness and reload diagnostics before claiming live state.
- Preserve unrelated changes in the shared working tree and stage only files named by each task.

---

### Task 1: Remove the confirmed diarization read-permission 403

**Files:**
- Modify: `backend/workers/diarization.test.ts`
- Modify: `backend/workers/diarization.ts`

**Interfaces:**
- Consumes: `NetworkJobCapability.policies` capability grants.
- Produces: permission for the Python worker to perform overlap and existing-label reads from `db/diarizations`.

- [ ] **Step 1: Write the failing capability test**

Add the missing literal grant to the expected complete policy array:

```ts
{ resource: "db/diarizations", action: "read", effect: "allow" },
```

The production change that makes this test fail is removal of the read grant required by `_get_overlap_segments` or `_get_existing_speaker_labels`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd backend && deno test --allow-env workers/diarization.test.ts
```

Expected: FAIL because the production capability does not contain the read grant.

- [ ] **Step 3: Add the minimum production grant**

Insert this policy before the existing write/update grants:

```ts
{ resource: "db/diarizations", action: "read", effect: "allow" },
```

Do not replace the three explicit actions with `action: "*"`.

- [ ] **Step 4: Verify GREEN and type-check the worker**

Run:

```bash
cd backend && deno test --allow-env workers/diarization.test.ts
cd backend && deno check workers/diarization.ts
```

Expected: all checks pass.

- [ ] **Step 5: Commit the isolated hotfix**

```bash
git add backend/workers/diarization.test.ts backend/workers/diarization.ts
git commit -m "fix: allow diarization overlap reads"
```

- [ ] **Step 6: Deploy only the backend and prove the 403 is gone**

Because the effective backend mode is `start`, recreate only backend, restart nginx, wait for `[READY]`, and verify `/health` and `/readiness`. Launch one bounded generation through the normal run-creation UI, then inspect its access logs. Expected: `db.diarizations:read` succeeds and no HTTP 403 is emitted. If another error occurs, stop and diagnose it before continuing.

---

### Task 2: Snapshot the selected diarizator instead of the LLM profile

**Files:**
- Modify: `backend/app/lib/diarization/provider-routing.ts`
- Modify: `backend/app/lib/diarization/provider-routing.test.ts`
- Modify: `backend/app/lib/jobs/queue.ts`
- Modify: `frontend/src/lib/jobRouting.test.ts`

**Interfaces:**
- Consumes: selected `ExternalServiceHealth` fields `providerProfileId`, `providerProfileName`, and `baseUrl`.
- Produces: `buildDiarizatorJobSnapshot(route, existingContext, resolvedAt)` returning `{ diarizationServerUrl, routingContext }`.

- [ ] **Step 1: Write a failing pure snapshot test**

Add a test where the existing context contains the primary LLM name `selfhost` and the selected route is `faeon-diar`:

```ts
expect(buildDiarizatorJobSnapshot({
  providerProfileId: "faeon",
  providerProfileName: "faeon-diar",
  baseUrl: "http://100.119.163.116:8085",
}, {
  providerProfileName: "selfhost",
}, "2026-08-10T00:00:00.000Z")).toEqual({
  diarizationServerUrl: "http://100.119.163.116:8085",
  routingContext: {
    providerProfileId: "faeon",
    providerProfileName: "faeon-diar",
    sourceId: "diarization:faeon",
    resolvedAt: "2026-08-10T00:00:00.000Z",
  },
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd backend && deno test app/lib/diarization/provider-routing.test.ts
```

Expected: FAIL because `buildDiarizatorJobSnapshot` does not exist.

- [ ] **Step 3: Implement the pure helper and use it in enqueue**

The helper must replace every provider-specific field rather than spreading the LLM provider name:

```ts
export function buildDiarizatorJobSnapshot(route, _existingContext, resolvedAt) {
  return {
    diarizationServerUrl: route.baseUrl,
    routingContext: {
      providerProfileId: route.providerProfileId,
      providerProfileName: route.providerProfileName,
      sourceId: `diarization:${route.providerProfileId}`,
      resolvedAt,
    },
  };
}
```

Apply the result for `diarization`, `enrollment`, and `profileReenrollment` in `enqueueJob`.

- [ ] **Step 4: Verify backend and frontend route tests**

Run:

```bash
cd backend && deno test app/lib/diarization/provider-routing.test.ts
cd frontend && deno task test --run src/lib/jobRouting.test.ts
```

Expected: tests pass; the existing frontend projection displays the corrected immutable snapshot without historical repair.

- [ ] **Step 5: Commit provenance repair**

```bash
git add backend/app/lib/diarization/provider-routing.ts backend/app/lib/diarization/provider-routing.test.ts backend/app/lib/jobs/queue.ts frontend/src/lib/jobRouting.test.ts
git commit -m "fix: snapshot selected diarizator provenance"
```

---

### Task 3: Emit complete per-sequence progress and approximate ETA

**Files:**
- Modify: `python/jobs/diarization.py`
- Modify: `python/tests/test_voice_identity_jobs.py`
- Create: `frontend/src/lib/diarizationProgress.ts`
- Create: `frontend/src/lib/diarizationProgress.test.ts`
- Modify: `frontend/src/pages/JobsPage.tsx`
- Modify: `frontend/src/pages/JobDetailPage.tsx`

**Interfaces:**
- Produces Python progress fields: `stage`, `message`, `total_chunks`, `chunks_processed`, `chunks_remaining`, `sequences_processed`, `segments_created`, `errors`, `elapsed_seconds`, `chunks_per_second`, `eta_seconds`.
- Produces frontend `getDiarizationProgressView(progress)` with optional `percent`, `remainingLabel`, `rateLabel`, and `etaLabel`.

- [ ] **Step 1: Write failing Python progress tests**

Use a controlled monotonic clock and two real result dictionaries. Capture progress callback payloads and assert literal values:

```python
assert updates[-1]["total_chunks"] == 10
assert updates[-1]["chunks_processed"] == 3
assert updates[-1]["chunks_remaining"] == 7
assert updates[-1]["sequences_processed"] == 1
assert updates[-1]["chunks_per_second"] == 0.5
assert updates[-1]["eta_seconds"] == 14.0
```

Add a second test where `chunks_diarized` is zero and assert `eta_seconds is None`.

- [ ] **Step 2: Verify Python RED**

Run:

```bash
cd python && uv run pytest -q tests/test_voice_identity_jobs.py
```

Expected: FAIL because progress is not emitted after the first sequence and does not contain the complete fields.

- [ ] **Step 3: Implement complete progress snapshots**

Record `started_at = time.monotonic()` before processing. After every sequence calculate:

```python
elapsed_seconds = max(time.monotonic() - started_at, 0.0)
chunks_remaining = max(pending_count - chunks_processed, 0)
chunks_per_second = (
    chunks_processed / elapsed_seconds
    if chunks_processed > 0 and elapsed_seconds > 0
    else None
)
eta_seconds = (
    chunks_remaining / chunks_per_second
    if chunks_per_second and chunks_per_second > 0
    else None
)
```

Call `progress_callback` after every sequence with every contract field. Retain final result fields used by `hasMore` chaining.

- [ ] **Step 4: Verify Python GREEN**

Run the focused Python file and the existing diarization worker tests:

```bash
cd python && uv run pytest -q tests/test_voice_identity_jobs.py tests/test_diarization_worker.py
```

- [ ] **Step 5: Write failing frontend formatter tests**

Assert hand-derived rendering data for known, unknown, and zero-progress totals:

```ts
expect(getDiarizationProgressView({
  total_chunks: 10,
  chunks_processed: 3,
  chunks_remaining: 7,
  chunks_per_second: 0.5,
  eta_seconds: 14,
})).toMatchObject({
  percent: 30,
  remainingLabel: "7 chunks remaining in range",
  rateLabel: "30.0 chunks/min",
  etaLabel: "About 14s remaining",
});
```

- [ ] **Step 6: Verify frontend RED, implement formatter, then verify GREEN**

Run before and after implementation:

```bash
cd frontend && deno task test --run src/lib/diarizationProgress.test.ts
```

The formatter must omit `percent` when total is absent or non-positive and return `ETA available after the first completed sequence` when ETA is absent.

- [ ] **Step 7: Render progress on Jobs and Job Details**

Use the pure view model. Render `<Progress value={percent} />` only when `percent` is defined. Show all numeric counters without claiming a run-wide percentage across continuation jobs.

- [ ] **Step 8: Run focused frontend tests and build**

```bash
cd frontend && deno task test --run src/lib/diarizationProgress.test.ts src/lib/jobRouting.test.ts
docker compose build frontend
```

- [ ] **Step 9: Commit progress feature**

```bash
git add python/jobs/diarization.py python/tests/test_voice_identity_jobs.py frontend/src/lib/diarizationProgress.ts frontend/src/lib/diarizationProgress.test.ts frontend/src/pages/JobsPage.tsx frontend/src/pages/JobDetailPage.tsx
git commit -m "feat: report diarization remaining work and eta"
```

---

### Task 4: Add numeric diarizator route controls to Jobs

**Files:**
- Modify: `frontend/src/lib/diarizationSettings.ts`
- Modify: `frontend/src/lib/diarizationSettings.test.ts`
- Modify: `frontend/src/pages/JobsPage.tsx`

**Interfaces:**
- Produces: `updateDiarizationRouteConfig(config, profileId, patch)` returning a complete `diarizationProfiles` object without mutating input.
- Consumes: existing config resource `get` and `patch`, plus `pipeline_health` route list.

- [ ] **Step 1: Write failing immutable-update tests**

Cover a remote profile and the environment route. Assert that updating `faeon` priority to 40 preserves the second profile, names, URLs, enable flags, and environment priority. Assert that disabling the last available route returns the existing validation error.

- [ ] **Step 2: Verify RED**

```bash
cd frontend && deno task test --run src/lib/diarizationSettings.test.ts
```

Expected: FAIL because the immutable update helper is missing.

- [ ] **Step 3: Implement the config helper**

For `profileId === "environment"`, map `enabled` to `includeEnvironment` and priority to `environmentPriority`. For a remote ID, map only the matching profile. Pass the result through `validateDiarizationRoutes` and throw its concrete message on failure.

- [ ] **Step 4: Verify helper GREEN**

Run the same focused test; expected PASS.

- [ ] **Step 5: Add Jobs mutations and controls**

For each diarizator health route render:

```tsx
<Switch checked={route.enabled} ... />
<Input type="number" min={1} max={100} value={draftPriority} ... />
<Button disabled={!dirty || pending}>Save</Button>
```

Fetch the canonical config inside each mutation, apply the pure helper, patch `diarizationProfiles`, and force health only when enabling. On success invalidate routing config and health. On failure keep the draft and show `serviceTestResults.diarizator`.

- [ ] **Step 6: Verify frontend tests and production build**

```bash
cd frontend && deno task test --run src/lib/diarizationSettings.test.ts
docker compose build frontend
```

- [ ] **Step 7: Commit route controls**

```bash
git add frontend/src/lib/diarizationSettings.ts frontend/src/lib/diarizationSettings.test.ts frontend/src/pages/JobsPage.tsx
git commit -m "feat: manage diarizator priorities from jobs"
```

---

### Task 5: Replace stale generation rerun with fresh run creation

**Files:**
- Create: `frontend/src/lib/diarizationGeneration.ts`
- Create: `frontend/src/lib/diarizationGeneration.test.ts`
- Modify: `frontend/src/pages/JobDetailPage.tsx`
- Modify: `backend/app/lib/jobs/queue.ts`
- Create: `backend/app/lib/jobs/generation-preflight.ts`
- Create: `backend/app/lib/jobs/generation-preflight.test.ts`

**Interfaces:**
- Produces frontend `buildReplacementGenerationInput(job, runs, health, now)` with new `runId`, next generation, range, fingerprints, and `replacesRunId`.
- Produces backend `assertBuildingGenerationRun(data, mongo)` which returns normally for non-generation jobs and throws a concrete error for a missing or terminal generation run.

- [ ] **Step 1: Write failing frontend generation tests**

Given a failed job with `runId=old`, active run `legacy-v0`, maximum generation 3, and healthy `faeon-diar`, assert a new ID, generation 4, the original range, and `replacesRunId=legacy-v0`. Assert the returned enqueue payload never contains `runId=old`.

- [ ] **Step 2: Verify frontend RED and implement the pure builder**

```bash
cd frontend && deno task test --run src/lib/diarizationGeneration.test.ts
```

Implement the builder with an injected `now` for deterministic IDs, then rerun to PASS.

- [ ] **Step 3: Use `Start new generation` on Job Details**

For `job.type === "diarization" && job.data.mode === "build_generation"`, replace the label and mutation. The mutation must fetch health and runs, call `speaker-segments:create-run`, then enqueue the fresh job and navigate to it. Normal jobs keep the current one-click rerun.

- [ ] **Step 4: Write failing backend preflight tests**

Use an in-memory async `mongo` double that returns `{ status: "failed" }` and assert the literal operator message contains `Start a new generation`. Test a building run passes and a missing-mode job does not query runs.

- [ ] **Step 5: Verify backend RED, implement preflight, and verify GREEN**

```bash
cd backend && deno test app/lib/jobs/generation-preflight.test.ts
```

Call the helper in `enqueueJob` after schema validation but before writing the Mongo job record or adding BullMQ work.

- [ ] **Step 6: Run focused suites and build**

```bash
cd backend && deno test --allow-env app/lib/jobs/generation-preflight.test.ts workers/diarization.test.ts
cd frontend && deno task test --run src/lib/diarizationGeneration.test.ts src/lib/diarizationProgress.test.ts
docker compose build frontend
```

- [ ] **Step 7: Commit safe recovery**

```bash
git add frontend/src/lib/diarizationGeneration.ts frontend/src/lib/diarizationGeneration.test.ts frontend/src/pages/JobDetailPage.tsx backend/app/lib/jobs/queue.ts backend/app/lib/jobs/generation-preflight.ts backend/app/lib/jobs/generation-preflight.test.ts
git commit -m "fix: create fresh runs for generation retries"
```

---

### Task 6: Deploy and verify the complete operator workflow

**Files:**
- Modify only if evidence requires correction; otherwise no source changes.

**Interfaces:**
- Consumes all prior tasks.
- Produces live evidence for service state, route state, provenance, progress, and safe generation behavior.

- [ ] **Step 1: Run all focused automated checks**

```bash
cd backend && deno test --allow-env workers/diarization.test.ts app/lib/diarization/provider-routing.test.ts app/lib/jobs/generation-preflight.test.ts
cd python && uv run pytest -q tests/test_voice_identity_jobs.py tests/test_diarization_worker.py
cd frontend && deno task test --run src/lib/diarizationSettings.test.ts src/lib/diarizationProgress.test.ts src/lib/diarizationGeneration.test.ts src/lib/jobRouting.test.ts
docker compose --profile diarization config --quiet
```

- [ ] **Step 2: Follow production-mode reload diagnostics**

Read `DEVELOPMENT.md`, verify mounts and effective `FRONTEND_MODE`/`BACKEND_TASK`, rebuild frontend, recreate only backend/frontend as needed, restart nginx, wait for backend `[READY]`, then verify container health plus `/health=200` and `/readiness=200`.

- [ ] **Step 3: Verify Jobs route controls in the browser**

Confirm environment/local is disabled, `faeon-diar` is enabled, URL is `http://100.119.163.116:8085`, exact numeric priority saves, and health is visible. Do not enable local as part of testing.

- [ ] **Step 4: Launch a new bounded seven-day generation**

Use the generation operation, not generic rerun. Verify the new run is `building`, the job label is `faeon-diar`, `db.diarizations:read` is allowed, and no 403 occurs.

- [ ] **Step 5: Observe real progress**

Wait for at least one successful sequence. Verify Jobs and Job Details show total, processed, remaining, rate, and ETA. If the remote service fails before one completed sequence, verify the explicit ETA fallback instead of claiming an estimate.

- [ ] **Step 6: Verify safety boundaries**

Confirm no run was activated or purged. On an old failed generation, verify the action reads `Start new generation` and produces a different run ID.

- [ ] **Step 7: Final repository audit**

Run `git status --short`, ensure only unrelated pre-existing files remain, and report commit IDs, deployed services, observed states, and any external blocker separately.
