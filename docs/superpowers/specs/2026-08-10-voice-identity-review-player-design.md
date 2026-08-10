# Voice Identity Review Player Design

**Status:** approved direction, awaiting written-spec review

**Goal:** Make `/settings/voice-identity` a fast, understandable audio-review workflow for labeling Sky/not-Sky examples and knowing exactly what happens after the first 100 labels.

## Selected approach

Use a single focused review card backed by the existing 100-item queue. Only the active segment loads audio. The card owns playback, keyboard and swipe interaction, while the page owns labeling, progress, undo history, and calibration guidance.

This is preferred over two alternatives:

- An inline player on every row would be the smallest visual change, but it would eagerly create many audio controls, make keyboard focus ambiguous, and make auto-advance hard to follow.
- A full-screen review modal would be focused, but it would hide profile readiness, calibration progress, and the next pipeline action.

The selected card keeps the operational context visible without loading 100 audio clips at once.

## Review card

The page shows one active segment with:

- recording date and a link to the diarization detail;
- exact segment duration computed from `end - start`;
- an authenticated waveform player using `/api/audio/wav` for the segment range;
- a model-result badge;
- large `Not me` and `This is me` actions;
- previous/next controls that do not label a segment;
- a persisted `Automatically play next` switch;
- shortcut hints.

The model-result badge has explicit semantics:

- no `speakerIdentity.primaryScore`: `Not classified`;
- score present: `Similarity to Sky: N%`;
- the supporting copy says similarity is a matcher score, not a calibrated probability;
- a score changes only when identity matching is run again with a changed profile, calibration, embedding, matcher, or diarization generation. It does not drift merely because time passes.

The existing misleading fallback from a missing score to `0%` is removed.

## Interaction contract

The default interaction is optimized for repeated review:

- `Space`: play or pause the active segment;
- `ArrowLeft`: label `Not me`;
- `ArrowRight`: label `This is me`;
- `ArrowUp` / `ArrowDown`: previous / next unreviewed segment;
- `U`: undo the latest decision from this browser session;
- touch or pointer swipe left: `Not me`;
- touch or pointer swipe right: `This is me`.

Shortcuts do nothing while an input, textarea, select, button, or content-editable element has focus. A labeling shortcut or swipe is ignored while a label or undo mutation is pending.

After a successful answer, the reviewed card leaves the queue. If `Automatically play next` is enabled, the next segment becomes active and starts playing. The switch defaults to enabled and is stored in local storage. If disabled, the next segment is selected but remains paused.

Playback errors stay on the current card and show a retryable message. A failed label keeps the segment visible and does not advance.

## Manual decisions and undo

Both answers use the existing `speaker-segments / annotate` action:

- `This is me` sends `profileId` and no exclusions;
- `Not me` sends the Sky profile in `excludedProfileIds` and no `profileId`.

`annotate` already returns the inserted annotation ID. The page stores the returned ID, decision, and segment in a session history stack. `Undo` calls `delete-annotation` for the latest history entry, puts that segment back at the front of the local queue, adjusts session progress, and selects it. Multiple consecutive undo operations are allowed for decisions made during the current page session.

This does not rewrite `speakerIdentity`; the manual annotation remains the authoritative override and the queue continues to exclude annotated segments.

## Progress and calibration guidance

The page distinguishes three different quantities:

1. **Review session:** answered in this session out of the queue size captured when the page loaded.
2. **Calibration dataset:** Sky count toward 40, not-Sky count toward 40, and total count toward 100 across recordings.
3. **Identity backfill:** identified, unknown, uncertain, and unclassified stored segments. This remains separate from manual-label progress.

The progress display must never call an unclassified segment `0%`. It uses labeled counts and an accessible progress bar with visible numerator and denominator. Counts refresh immediately after answer or undo.

Before the minimum dataset is ready, the page says exactly which constraint is missing. Once there are at least 100 total labels, including at least 40 Sky and 40 not-Sky across enough recordings to create non-overlapping sets, the page changes its primary next action to `Configure validation split` and scrolls to the existing calibration section.

The post-100 operator workflow shown in the UI is:

1. split labeled recordings into calibration and validation sets;
2. validate Sky precision at or above 98%;
3. run `Classify existing` on a one-day pilot;
4. review matched, rejected, and uncertain pilot results;
5. expand to seven days, then run bounded historical backfill.

The first 100 labels are a minimum gate, not a stopping point. More diverse recordings improve calibration, and uncertain results remain a continuing review queue after backfill.

## Component boundaries

- `VoiceIdentityReviewPage.tsx` owns queries, mutations, queue/history state, progress, keyboard/swipe actions, and next-step guidance.
- `VoiceIdentityReviewPlayer.tsx` renders the active card and converts buttons, keyboard commands passed by the page, and pointer gestures into typed callbacks.
- `WaveformPlayer.tsx` gains a small controlled interface for autoplay and imperative play/pause. It remains responsible for authenticated audio loading, waveform rendering, and the single-playback coordinator.
- `speaker-segments` keeps its existing annotation and deletion contracts; no new database collection or destructive migration is required.

## Error and concurrency handling

- Only one label/undo mutation may be active at a time.
- The UI advances only after the server returns the annotation ID.
- A refetch may remove annotated segments but must not reset the active card to the first item or erase session progress.
- Undo failure leaves the history entry available for another attempt.
- Audio object URLs are revoked and playback ownership is released when the active segment changes or the page unmounts.
- Empty queues distinguish `all reviewed in this loaded queue` from `no diarized/reviewable segments found`.

## Verification scope

Testing is intentionally focused on important behavior rather than exhaustive coverage:

- one component test covers missing-score semantics, duration, shortcuts, pending protection, and swipe mapping;
- one page-flow test covers answer, annotation ID capture, auto-advance, immediate progress update, and undo;
- existing audio single-playback tests remain the regression guard for player coordination;
- type-check the changed frontend files;
- live browser verification covers play, `This is me`, next autoplay, undo, `Not me`, shortcuts, persisted toggle, and progress changes against local data.

No broad full-suite run is required unless focused verification exposes a shared regression.
