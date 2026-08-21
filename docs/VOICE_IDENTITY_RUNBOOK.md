# Voice Identity runbook

## Safety model

- Never re-run VAD or STT merely to classify an existing embedding.
- Never match different `embeddingSpaceId` values.
- Never activate a building/failed run.
- Never purge active/building data. Preview first; back up Mongo and verify
  restore before the first physical purge.
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

The health response must include `diarizationFingerprint` and
`embeddingSpaceId`. The backend Jobs health panel must show the diarizator as
healthy before enrollment or re-diarization.

## First migration

Migration `0035_voice_identity_versioning` creates runs, annotations and
calibration collections. It registers existing segments as `legacy-v0` /
`legacy-unknown`, preserving every embedding value.

Verify counts before and after:

```javascript
db.diarizations.countDocuments({ embedding: { $exists: true } });
db.diarizations.countDocuments({
  runId: "legacy-v0",
  embeddingSpaceId: "legacy-unknown",
});
db.diarization_runs.findOne({ runId: "legacy-v0" });
```

## Pilot and backfill

1. `/settings/voice-identity`: re-enroll Sky from all saved samples.
2. Create an **Uncertain + unclassified** review session. Its 100-item windows
   are stratified across source recordings. Keep the default **Clear speech ·
   ≥1s · deduplicate** quality filter; use **All fragments** only to diagnose
   raw diarization. Label at least 100 compatible pilot segments (40 Sky, 40
   not-Sky, plus borderline/mixed).
   - Use **Skip** for noise, clipped/ambiguous speech and overlapping speakers.
   - Use **Edit** to change any saved label or Skip.
   - Use **Reviewed history** to reopen answers from older windows/sessions and
     listen, correct the speaker, or replace the label with Skip.
   - Assigning another speaker remembers that profile for the next segment and
     moves recently used profiles to the top of profile selectors.
   - The waveform has one global active player and a visible playhead; changing
     the review segment stops and disposes the previous clip.
3. Save validated thresholds. The server accepts only the selected Fit/Check
   recording IDs and recomputes thresholds and metrics itself. Only
   `server-computed-v1` records with at least 98% independent Check precision
   unlock classification.
4. `/audio/pipeline`: `Classify existing` for 7–14 days.
5. Create an **Audit automatic matches** session to inspect old/current matched
   candidates across different recordings; also review uncertain and rejected
   samples.
6. Expand by bounded ranges. `speakerIdentity` is idempotent for run/profile
   revision/calibration and continues with a cursor.

When **Save current clip as voice sample** succeeds in storing the audio but
all diarizator slots are reserved, keep the dialog open and use **Retry profile
update**. The stored clip is reused rather than uploaded again. If the dialog
was closed, use **Profiles & samples → Rebuild** to combine every saved sample
attached to that profile.

Absence of `speakerIdentity` means not evaluated. After evaluation, every
eligible segment is `matched`, `rejected` or `uncertain`. Automatic decisions
whose calibration is missing or stale remain stored for audit, but are shown as
unclassified on Timeline/Transcript and counted under `stale decisions`, not as
verified results.

## Re-diarization

`Re-diarize range` creates a building run from already VAD-qualified chunks. It
does not clear `diarized_at` and does not change active Timeline data. When the
bounded chain finishes, the run becomes ready.

Use `Compare` before `Activate`. Activation writes the new active segments
first, then supersedes only overlapping old segments. A retained superseded run
can be activated again as rollback.

## Purge

Use `Preview purge`; compare document/embedding counts with the intended run.
Enter the exact string `PURGE <runId>`. Only superseded/failed diarization
documents are deleted. Audio, chunks, transcripts, profiles and annotations
remain.

## Verification

Follow `DEVELOPMENT.md` readiness diagnostics: confirm bind mounts and the
effective runtime mode. Live source reload requires `APP_MODE=dev`;
`APP_MODE=prod` requires explicit rebuild/recreation. Verify `[READY]` logs,
container health, `/audio/pipeline`, `/settings/voice-identity`, `/timeline`,
`/transcript`, and a real annotation round-trip.
