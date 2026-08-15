# Diarization live-trigger controls and compact logging

## Goal

Remove false `diarization-live-*` jobs caused by diarization's own chunk updates,
allow operators to disable live event processing without stopping historical or
manual campaigns, and stop logging full Pyannote outputs at INFO level.

## Trigger contract

Mongo change events expose the names of updated fields in a normalized
`changedFields` array. The live diarization source triggers only when:

- the operation is an update;
- `changedFields` contains `vad.has_speech`;
- the resulting document has `vad.has_speech=true`;
- live diarization is enabled.

Updates to `processing_by`, `claimed_at`, `diarized_at`, failure metadata, or
overlap-chunk release must not enqueue live work. The 300-second historical
watchdog and `hasMore` continuation do not depend on this event filter.

## Operator toggle

Add `liveTriggerEnabled` to the persisted diarization worker configuration and
show a **Live diarization** switch on Jobs next to the diarization controls.

- Default: `true` when no value is stored, preserving existing installations.
- Off: ignore only `speech_missing_diarization` change-stream events.
- Still active while off: manual jobs, historical watchdog/startup recovery,
  existing campaigns, and `hasMore` continuations.
- The UI explains this boundary and saves through the existing worker-config
  resource rather than writing MongoDB directly.

For the current deployment the operator can switch it off after the updated
backend/frontend are live.

## Logging

Replace `logger.info("Diarization output: ...")` with a DEBUG-only structural
summary. INFO retains useful request completion records:

- number of segments;
- number of speakers;
- diarization time;
- embedding time;
- total time.

No embedding arrays or full Pyannote output are emitted at INFO.

## Tests

Only critical contracts are covered:

1. Normalized Mongo change metadata contains changed field names.
2. A VAD transition to speech matches the live source.
3. Claim/release/diarized updates do not match it.
4. Disabling live triggers suppresses event jobs but does not suppress interval
   or manual/historical processing.
5. The diarizator INFO path does not format the full model output.

Run the focused backend trigger tests and focused diarizator test only. Full
repository coverage is intentionally out of scope.

## Deployment

Backend and frontend changes require recreating those application services and
restarting nginx. The diarizator logging change requires a new self-contained
`linux/amd64` CUDA image on remote-1, followed by `/health`, `/embed`, `/diarize`,
and GPU verification. No historical data reset or re-diarization is required.
