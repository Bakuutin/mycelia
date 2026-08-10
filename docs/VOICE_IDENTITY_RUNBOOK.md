# Voice Identity runbook

## Safety model

- Never re-run VAD or STT merely to classify an existing embedding.
- Never match different `embeddingSpaceId` values.
- Never activate a building/failed run.
- Never purge active/building data. Preview first; back up Mongo and verify restore before the first physical purge.
- Keep manual labels in `speaker_annotations`; do not rewrite transcript text.

## Bring-up

```bash
docker compose --profile diarization up -d --build diarizator
docker compose exec diarizator curl -fsS http://127.0.0.1:8085/health
docker compose up -d --build backend python-worker frontend
docker compose restart nginx
curl -fkSs https://localhost:4433/readiness
```

The in-network URL for local jobs is `http://diarizator:8085`. Prefer the
container-internal health command above: local IDE/SSH port forwards may also
claim host port 8085 and make `curl localhost:8085` reach a different machine.

The health response must include `diarizationFingerprint` and `embeddingSpaceId`. The backend Jobs health panel must show the diarizator as healthy before enrollment or re-diarization.

## First migration

Migration `0035_voice_identity_versioning` creates runs, annotations and calibration collections. It registers existing segments as `legacy-v0` / `legacy-unknown`, preserving every embedding value.

Verify counts before and after:

```javascript
db.diarizations.countDocuments({embedding: {$exists: true}})
db.diarizations.countDocuments({runId: "legacy-v0", embeddingSpaceId: "legacy-unknown"})
db.diarization_runs.findOne({runId: "legacy-v0"})
```

## Pilot and backfill

1. `/settings/voice-identity`: re-enroll Sky from all saved samples.
2. Label at least 100 pilot segments from separate recordings (40 Sky, 40 not-Sky, plus borderline/mixed).
3. Save validated thresholds. Server rejects precision below 98%, overlapping calibration/validation recordings and insufficient labels.
4. `/audio/pipeline`: `Classify existing` for 7–14 days.
5. Review uncertain plus random matched/rejected samples.
6. Expand by bounded ranges. `speakerIdentity` is idempotent for run/profile revision/calibration and continues with a cursor.

Absence of `speakerIdentity` means not evaluated. After evaluation, every eligible segment is `matched`, `rejected` or `uncertain`.

## Re-diarization

`Re-diarize range` creates a building run from already VAD-qualified chunks. It does not clear `diarized_at` and does not change active Timeline data. When the bounded chain finishes, the run becomes ready.

Use `Compare` before `Activate`. Activation writes the new active segments first, then supersedes only overlapping old segments. A retained superseded run can be activated again as rollback.

## Purge

Use `Preview purge`; compare document/embedding counts with the intended run. Enter the exact string `PURGE <runId>`. Only superseded/failed diarization documents are deleted. Audio, chunks, transcripts, profiles and annotations remain.

## Verification

Follow `DEVELOPMENT.md` readiness diagnostics: confirm bind mounts and the
effective runtime mode. Live source reload requires `BACKEND_TASK=dev` and
`FRONTEND_MODE=dev`; `start`/`prod` requires explicit rebuild/recreation.
Verify `[READY]` logs, container health, `/audio/pipeline`,
`/settings/voice-identity`, `/timeline`, `/transcript`, and a real annotation
round-trip.
