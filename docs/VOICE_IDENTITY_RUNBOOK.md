# Voice Identity runbook

## Safety model

- Never re-run VAD or STT merely to classify an existing embedding.
- Never match different `embeddingSpaceId` values.
- Never activate a building/failed run.
- Never purge active/building data. Preview first; back up Mongo and verify
  restore before the first physical purge.
- Keep manual labels in `speaker_annotations`; do not rewrite transcript text.

Live and retroactive convenience matching must receive exact embedding
provenance. They compare a segment only with profiles whose `embeddingSpaceId`
equals the admitted route/segment space, and skip automatic matching when that
value is missing or legacy. New `matched_speaker` values record the profile
revision and embedding space used. Older automatic matches without those fields
remain unverified legacy candidates: do not backfill a current revision onto
them, because that would not prove which profile revision made the original
decision.

`matched_speaker` from generic live/retroactive matching is not a calibrated
identity decision. Only a compatible `speakerIdentity` result produced from a
validated calibration is verified. Manual speaker annotations remain
authoritative and are not affected by rebuilding embeddings or calibration.

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

The health response must include `modelId`, `modelVersion`,
`diarizationFingerprint`, and `embeddingSpaceId`. Older compatible servers may
omit the compact aliases only when `diarizationFingerprint.model` and
`diarizationFingerprint.resolvedRevision` are present. The backend Jobs health
panel must show the diarizator as healthy before enrollment or re-diarization.

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

Migrations `0066_speaker_review_source_index` and
`0067_speaker_review_range_index` keep full-backlog and bounded-range review
previews indexed. They are applied automatically at backend startup. Preview
scans at most 5,000 raw segments per request, shows elapsed time in the UI, and
reports capped totals as `at least N`.

## Pilot and backfill

The **Voice identity** card on `/audio/pipeline` shows the primary profile,
current server blockers, and a direct **Open calibration setup** link. Follow
the displayed `label → fit → validate → save → classify` sequence; calibration
reuses stored diarization embeddings and does not rerun audio processing.

1. `/settings/voice-identity`: re-enroll Sky from all saved samples.
2. Start an **Uncertain + unclassified** continuous review stream. **Check
   available audio** freezes the selected source, then **Start continuous
   review** begins labeling. The default 10-item buffer (advanced options allow
   5/10/20) is only for preloading: with **Continuous** enabled, the next buffer
   arrives automatically and there is no batch-complete button. The stream
   progress is separate from the calibration total, which includes usable labels
   from every saved stream. Keep the default **Clear speech · ≥1s ·
   deduplicate** quality filter; use **All fragments** only to diagnose raw
   diarization. Label at least 100 compatible pilot segments (40 Sky, 40
   not-Sky, plus borderline/mixed).
   - Use **Skip** for noise, clipped/ambiguous speech and overlapping speakers.
   - Use **Edit** to change any saved label or Skip.
   - Use **Reviewed history** to reopen answers from older windows/sessions and
     listen, correct the speaker, or replace the label with Skip.
   - Assigning another speaker remembers that profile for the next segment and
     moves recently used profiles to the top of profile selectors.
   - The waveform has one global active player and a visible playhead; changing
     the review segment stops and disposes the previous clip. The next three
     pending clips/groups are fetched into a bounded browser cache, so autoplay
     normally starts without another audio download wait.
   - Choose the source explicitly: all matching recordings, selected recordings,
     an exact Timeline selection, or one active compatible diarization
     generation. **Check available audio** shows counts, quality exclusions,
     recordings, and playable samples. The server freezes that exact scope and
     reapplies it to every preload buffer.
3. Choose the required independent Check precision and save the calculated
   thresholds. Use `98%` for production, a `95%`/`90%` preset for a provisional
   run, or a custom `90–100%` value in `0.5%` steps. This control is a precision
   policy, not a raw cosine threshold. Values below `98%` require accepting the
   false-match risk and unlock only a job with start/end covering at most 24
   hours. The server accepts only the selected Fit/Check recording IDs and
   recomputes the cosine thresholds and metrics itself; the worker enforces the
   stored policy again when a job starts. If the server cannot prove a safe
   negative threshold, the preview says **Auto not-Sky off · remains uncertain**
   and saves `negativeDecisionMode=uncertain_only`. This is intentional
   Sky-first behavior: automatic Sky matches remain available, but every other
   score is left uncertain instead of being auto-rejected. Manual not-Sky labels
   remain intact. For a provisional target, **Advanced · stricter automatic Sky
   matching** can raise the positive cosine threshold above the server
   recommendation in `0.005` steps. It can never lower it. A higher threshold
   usually reduces matches, coverage, and recall, but may improve precision. The
   preview marks this as `positiveThresholdSource=operator_stricter`; **Use
   server recommendation**, changing the precision target, or changing the
   Learn/Check split clears the override. This tuning is disabled for production
   because choosing a threshold after seeing Check metrics would contaminate
   independent validation. **Learn** recordings choose the threshold;
   **Independent check** recordings measure it on unseen audio; **Not used**
   keeps labels saved but excludes that recording from the current calculation.
   Recording-role changes recalculate automatically. **Refresh result** repeats
   the same server calculation with the latest labels; it does not save a
   calibration or classify history until the final Save action succeeds.
4. Open `/jobs?type=speakerIdentity` and press play on the worker. The launcher
   resolves primary Sky, its current revision, the usable server calibration,
   and a compatible active run without raw IDs. Run the 24-hour pilot first and
   inspect its false positives. The 7/14-day and longer options become available
   only after saving a production calibration with a ≥98% target.
5. Create an **Audit automatic matches** session to inspect old/current matched
   candidates across different recordings; also review uncertain and rejected
   samples.
6. Expand by bounded ranges. `speakerIdentity` is idempotent for run/profile
   revision/calibration and continues with a cursor.

Enrollment and profile re-enrollment share a priority admission queue with
diarization. When all diarizator slots are busy, the job remains **Waiting for
diarizator slot** and starts automatically at the next safe batch boundary; the
active model request is never interrupted. Profile rebuild/enrollment runs
before live diarization, generation builds, and historical backfill. Once the
profile job finishes, deferred diarization is admitted automatically. Jobs and
Job Details show the admission priority and waiting state.

Admission is event-driven: completion, failure, cancellation, or creation of a
deferred continuation immediately drains the shared pool in priority/FIFO order.
The 60-second maintenance pass is only a recovery watchdog for missed events.
Backend logs emit structured `[DIARIZATION_ADMISSION]` drain records with
admission wait time and occupied/free slot counts; while backlog exists, all
slots becoming idle for more than a few seconds is a fault signal. After the
priority/FIFO drain, terminal events also trigger ordinary historical work for
any still-free compatible route using BullMQ reservations rather than persisted
waiting counts. The periodic maintenance drain is only a watchdog.

Historical `missing` continuations prefer their previous diarizator but may use
another free route only when `modelId`, `modelVersion`, and `embeddingSpaceId`
match exactly. Enrollment, profile re-enrollment, targeted work, and generation
builds keep strict route affinity. Job routing snapshots and new diarization
segments store the runtime contract; enrollment and re-enrollment also store it
on the speaker profile. The worker compares the actual inference response with
the admitted contract before saving. Migration
`0069_diarizator_runtime_provenance` records the verified historical model
revision on existing segments, runs, profiles, and diarizator jobs. Existing job
routes on `8085` keep the legacy embedding space, while `8086`–`8090` and `8185`
use the current compatible space; local URLs whose exact embedding runtime is
not provable receive the model revision without a fabricated embedding space.

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
