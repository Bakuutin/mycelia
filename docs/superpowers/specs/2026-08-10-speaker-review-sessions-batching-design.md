# Speaker Review Sessions and Batching Design

**Status:** selected production design, awaiting written-spec review

**Goal:** Replace the oversized one-segment review card with a durable, compact review workspace that can play and label safe groups of short diarization segments, resume across devices, and scale from the current Sky/14-day pilot to multiple profiles and the full archive.

## Selected architecture

Use server-persisted review sessions, deterministic server-generated groups, and idempotent batch decisions.

Two rejected alternatives are intentionally not used:

- Browser-only persistence cannot resume on another device, loses skipped position when storage is cleared, and cannot coordinate concurrent reviewers.
- Rebuilding position only from annotations loses queue order, active/skipped items, grouping settings, and a stable historical cursor as new diarization arrives.

The selected design makes `Sky` and `last 14 days` initial UI defaults only. Neither value is embedded into storage or API contracts.

## Server-persisted sessions

Add `speaker_review_sessions` with:

- `_id`, `owner`, optional display name, `status: active | completed | abandoned`;
- `targetProfileIds`, `embeddingSpaceIds`, optional `runIds`;
- a query snapshot containing identity state filters, confidence filters, and range mode;
- range mode `fixed | all_before`, optional start/end, and immutable `snapshotEnd`;
- sort order and a stable cursor;
- current 100-item window, next cursor, and backlog estimate captured at count time;
- `activeSegmentId`, `activeGroupId`, reviewed/skipped counts, and session revision;
- grouping configuration and grouping algorithm version;
- UI preferences that affect workflow, including auto-play and compact/group mode;
- created, updated, last-opened, and completed timestamps.

`fixed` supports any custom time interval. `all_before` processes the entire historical backlog only up to `snapshotEnd`, so new segments cannot reorder an active session. After the current window is completed, the session loads the next 100 items from its cursor without creating a new session.

Server actions:

- `create-review-session` creates a stable query snapshot and first window;
- `list-review-sessions` returns resumable and recent sessions;
- `get-review-session` returns the window, groups, position, progress, and query metadata;
- `update-review-position` saves the active segment/group, skipped state, and preferences with optimistic revision checking;
- `load-next-review-window` advances the stored cursor and fills the next 100 items;
- `complete-review-session` closes a session without deleting annotations;
- `abandon-review-session` hides an unwanted session but retains its audit record.

The server is authoritative. The browser may cache the last session ID for faster opening, but loss of browser storage does not lose progress.

## Deterministic grouping

Grouping is computed on the server and stored in the session window so every client sees the same groups. Segments can share an automatic group only when all of these match:

- `originalId`;
- active diarization `runId`;
- `embeddingSpaceId`;
- anonymous diarization speaker label, when present.

Additional defaults:

- chronological gap between neighboring segments: at most 2 seconds;
- group wall-clock duration: at most 30 seconds;
- group size: at most 20 segments;
- a missing anonymous speaker label produces a singleton group;
- a recording, run, embedding space, or speaker boundary always starts a new group.

These defaults are stored with the session, not hardcoded into persisted decisions. A future grouping algorithm creates a new `groupingVersion`; existing sessions keep their original membership and remain reproducible.

One group is played as a continuous audio range from the first segment start to the last segment end, including short gaps for context. The UI still shows every constituent segment and its exact interval. A row click seeks playback to that segment's offset.

## Batch decisions and undo

Add `speaker_review_decisions` as the audit record for single- and multi-segment actions:

- `_id`, `sessionId`, `clientRequestId`, author, timestamps;
- `segmentIds`, original grouping metadata, and decision source;
- generalized target: optional `profileId`, excluded profile IDs, or `unknown`;
- `status: building | committed | rolled_back | failed`;
- generated annotation IDs and failure details.

`commit-review-decision` accepts one to 100 selected segments. The server validates that every segment belongs to the session window, is active, is still unannotated for the requested action, and is compatible with the requested target. Automatic one-click group decisions are limited to the server-produced group; manual multi-select can span groups but shows an explicit count and duration preview.

The write is resume-safe rather than dependent on Mongo transactions:

1. Upsert a decision by unique `sessionId + clientRequestId` in `building` state.
2. Upsert one `speaker_annotations` document per `decisionId + segmentId`.
3. Mark the decision committed only after every expected annotation exists.
4. Update the session window and position only after commit.

Retrying the same client request cannot duplicate annotations. `undo-review-decision` deletes only annotations belonging to that decision, marks it `rolled_back`, restores the affected items to the session window, and is also idempotent. Existing annotations created outside the session are never deleted by a session undo.

Current v1 quick actions are `Sky` and `Not Sky`. Their API representation is already generalized: a positive decision supplies a `profileId`; a negative decision supplies that profile in `excludedProfileIds`. Later UI can add Belka or other profiles without changing session, decision, annotation, or Timeline schemas.

## Compact review workspace

The page becomes a dense workspace instead of a stack of large cards:

### Sticky toolbar

- profile selector;
- session selector with `Resume`, `New session`, `Complete`, and last-opened time;
- range selector with 14 days as the default plus custom and full-backlog modes;
- overall backlog, session/window progress, and save state;
- auto-play and grouping controls.

### Compact player

- one shallow waveform for the active group;
- group time range, combined duration, segment count, recording, and matcher state;
- previous/next group, play/pause, and current segment position;
- group actions `All Sky`, `All Not Sky`, and a profile chooser;
- decision actions remain disabled until the group is loaded and server validation metadata is present.

### Full 100-item list

All items in the current window are rendered in a compact scrollable list with group headers. Each 32–40px row shows:

- checkbox and queue number;
- active/playback indicator;
- timestamp and duration;
- recording and anonymous speaker label;
- matcher state/score or `Not classified`;
- review state: pending, skipped, saving, saved, conflict, or error.

The active row stays highlighted and is scrolled into view. Group headers provide continuous play and safe group selection. Users can uncheck a suspicious segment before applying a group decision. Manual selection across groups is allowed, but the action bar must show the exact number of segments, recordings, and combined duration before submission.

Keyboard behavior remains:

- Space: play/pause;
- Up/Down: previous/next row;
- Left/Right: Not-profile/Profile for the active selected scope;
- Shift+Up/Down: extend selection;
- U: undo the last committed decision in this session.

## Progress and resume behavior

The UI distinguishes:

- current window: reviewed out of 100;
- session: committed/skipped out of all items loaded by this session;
- backlog estimate: remaining items matching the frozen query snapshot;
- calibration dataset: counts per profile, negative examples, total, and recordings;
- identity backfill: identified, unknown, uncertain, and unclassified segments.

Position is saved after row/group navigation with a short debounce. Decisions and undo save immediately. On reopen, the page shows `Resume <session name> · stopped at group N / segment M · updated <time>` and restores the exact window, active group, row, selection scope, and playback preference. Audio itself resumes paused at the group start; it never starts unexpectedly merely because a page was reopened.

Optimistic `revision` prevents two devices from silently overwriting position. A stale client receives the newer session state and an explicit `Session changed elsewhere` message. Already committed idempotent decisions remain valid.

## Indexes and lifecycle

Add indexes for:

- sessions by owner, status, and `lastOpenedAt`;
- active sessions by owner and target profile;
- decisions by session and committed time;
- unique decision `sessionId + clientRequestId`;
- partial unique annotation `decisionId + segmentId`;
- review queue discovery using the existing active lifecycle/start/identity indexes.

Completed and abandoned sessions are retained for audit and can be reopened read-only. A later retention policy may archive session windows while preserving decisions and annotations. This feature never deletes diarization, embeddings, raw audio, transcripts, or non-session annotations.

## Migration and rollout

- Existing manual annotations remain valid and are automatically excluded when a new session snapshot is created.
- The current browser-only session is not migrated because it has no durable identity; the first open after deployment offers `Create session from current review queue`.
- Default creation uses the selected profile and last 14 days, while custom and full-backlog choices use the same API.
- Start with one active session per owner/profile/query snapshot in the UI, while the schema permits multiple named sessions.
- Roll out single-group decisions first, then enable arbitrary cross-group selection after live validation of idempotency and conflict handling.

## Error handling

- A failed audio range keeps the list usable and exposes retry plus the individual segment link.
- Partial annotation writes leave the decision in `building`; retry resumes it and the UI does not advance prematurely.
- Invalid or newly annotated segments return per-item conflicts; unaffected selected items are not silently relabeled.
- A changed active diarization run does not rewrite an existing session. The session shows that its snapshot is stale and offers a new session on the current run.
- Groups with mixed or missing safety metadata cannot use one-click batch labeling; individual rows remain available.

## Focused verification

Testing remains proportional to risk:

- one pure grouping test covers boundaries for recording, run, embedding space, speaker, gap, duration, and segment count;
- one backend contract test covers idempotent batch commit, retry after partial persistence, conflict reporting, and exact batch undo;
- one frontend flow test covers resume, full-list rendering, group playback selection, batch label, progress, and undo;
- type-check changed backend/frontend files;
- live browser verification creates a small bounded session, commits and undoes one temporary group decision, reloads the page, and confirms exact position/session restoration.

No broad historical write or full test-suite run is part of this rollout.
