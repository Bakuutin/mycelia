# Voice Identity Review Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Sky review queue into an audio-first labeling workflow with
accurate score semantics, fast navigation, undo, and visible calibration
progress.

**Architecture:** A focused `VoiceIdentityReviewPlayer` renders one segment and
maps keyboard/pointer interaction to page callbacks. The existing
`WaveformPlayer` gains a small imperative/autoplay API.
`VoiceIdentityReviewPage` keeps React Query as canonical server state while
maintaining active position, session history, and autoplay preference locally.

**Tech Stack:** React 19, TypeScript, TanStack Query, existing authenticated
audio API, Zustand playback coordinator, Radix/shadcn components, Vitest,
Testing Library.

## Global Constraints

- Autoplay-next defaults to enabled and persists in local storage.
- Missing matcher score is `Not classified`, never `0%`.
- Similarity is described as a model score, not a probability.
- Manual annotations remain authoritative and are the only data changed by
  review/undo.
- Shortcuts do not fire from interactive or editable elements.
- Add only focused tests for the critical answer/advance/undo contract and input
  mapping.
- Preserve unrelated dirty-worktree files and stage only files listed by this
  plan.

---

### Task 1: Controlled waveform playback

**Files:**

- Modify: `frontend/src/components/audio/WaveformPlayer.tsx`

**Interfaces:**

- Produces: `WaveformPlayerHandle` with `play()`, `pause()`, and
  `togglePlayback()`.
- Produces: optional `autoPlay`, `onEnded`, and `ariaLabel` props.
- Preserves: authenticated fetch, waveform rendering, seek, duration display,
  and `useAudioPlaybackStore` ownership.

- [ ] **Step 1: Add the imperative interface**

Convert the component to `forwardRef<WaveformPlayerHandle, WaveformPlayerProps>`
and expose:

```ts
useImperativeHandle(ref, () => ({
  play: () => playAudio(),
  pause: () => audioRef.current?.pause(),
  togglePlayback,
}), [playAudio, togglePlayback]);
```

The shared `playAudio` function acquires playback ownership, awaits
`audio.play()`, and converts a rejected autoplay promise into visible paused
state without losing the loaded clip.

- [ ] **Step 2: Add autoplay and completion callbacks**

After successful decode, call `playAudio()` when `autoPlay` is true. Invoke
`onEnded` from the existing ended listener. Give the play button the provided
accessible name.

- [ ] **Step 3: Type-check the player**

Run: `cd frontend && deno check src/components/audio/WaveformPlayer.tsx`

Expected: exit 0.

### Task 2: Focused review card and interaction mapping

**Files:**

- Create: `frontend/src/pages/settings/VoiceIdentityReviewPlayer.tsx`
- Create: `frontend/src/pages/settings/VoiceIdentityReviewPlayer.test.tsx`

**Interfaces:**

- Consumes: a segment with `_id`, `original_id` or `original`, `start`, `end`,
  and optional `speakerIdentity.primaryScore`.
- Consumes callbacks: `onDecision("me" | "not-me")`, `onPrevious`, `onNext`, and
  `onUndo`.
- Produces: `VoiceIdentityReviewPlayer` and pure helpers `getReviewShortcut` and
  `getSwipeDecision`.

- [ ] **Step 1: Write the focused failing interaction test**

Mock `WaveformPlayer`, render an unclassified five-second segment, and assert:

```ts
expect(screen.getByText("Not classified")).toBeInTheDocument();
expect(screen.getByText("5.0 sec")).toBeInTheDocument();
fireEvent.keyDown(window, { key: "ArrowRight" });
expect(onDecision).toHaveBeenCalledWith("me");
fireEvent.keyDown(window, { key: "ArrowLeft" });
expect(onDecision).toHaveBeenCalledWith("not-me");
```

Also assert input focus suppresses shortcuts, pending state suppresses a second
decision, Space calls the imperative player handle, and horizontal pointer
deltas map right to `me` and left to `not-me`.

- [ ] **Step 2: Verify RED**

Run:
`cd frontend && deno task test --run src/pages/settings/VoiceIdentityReviewPlayer.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the review card**

Build an intentional two-column card at desktop width and one column on mobile.
Generate the audio URL from the normalized original ID and segment epoch-second
range. Render duration, score semantics, waveform, large decision buttons,
navigation, undo, autoplay switch, progress summary, and keyboard hints. Use a
72px horizontal / 48px vertical swipe threshold.

- [ ] **Step 4: Verify GREEN**

Run:
`cd frontend && deno task test --run src/pages/settings/VoiceIdentityReviewPlayer.test.tsx`

Expected: the focused interaction tests pass.

### Task 3: Queue, annotation history, progress, and next-step workflow

**Files:**

- Modify: `frontend/src/pages/settings/VoiceIdentityReviewPage.tsx`
- Modify: `frontend/src/pages/settings/VoiceIdentityReviewPage.test.tsx`

**Interfaces:**

- Consumes: `VoiceIdentityReviewPlayer` from Task 2.
- Uses: existing `speaker-segments` actions `annotate`, `delete-annotation`,
  `identity-status`, and `review-queue`.
- Produces: session history entries `{ annotationId, segment, decision }`,
  immediate query-cache updates, active index, and persisted autoplay
  preference.

- [ ] **Step 1: Extend the existing page test with the critical flow**

Return one primary profile and two queue segments from the API mock. Assert the
first segment renders as unclassified, then click `This is me`. Verify
`annotate` includes `profileId`, the second segment appears, session progress
increments, and the mocked player receives autoplay. Click `Undo`; verify
`delete-annotation` receives the returned ID and the first segment returns.

- [ ] **Step 2: Verify RED**

Run:
`cd frontend && deno task test --run src/pages/settings/VoiceIdentityReviewPage.test.tsx`

Expected: FAIL because the page still renders a flat list and uses `assign` for
Sky.

- [ ] **Step 3: Implement canonical queue updates**

Use a stable review query key. Replace the Sky `assign` request with `annotate`,
await the mutation in a single decision handler, remove the successful segment
with `queryClient.setQueryData`, push the returned annotation ID to history,
select the next valid index, and request autoplay only after a successful
answer. Invalidate/refetch identity status immediately without resetting the
local queue.

- [ ] **Step 4: Implement safe undo**

Delete the exact last annotation, prepend its segment if absent, pop history
only after success, select the restored segment, and keep the history entry on
failure.

- [ ] **Step 5: Replace the flat list with review and progress UI**

Render the focused card, session progress, the `40 Sky / 40 not-Sky / 100 total`
progress bars, queue remaining, and identity backfill counts. Add explicit
remaining-requirement copy. When the label gate passes, render
`Configure validation split`; below calibration render the five-step
pilot/backfill sequence from the approved design.

- [ ] **Step 6: Verify focused behavior and types**

Run:

```bash
cd frontend
deno task test --run src/pages/settings/VoiceIdentityReviewPlayer.test.tsx src/pages/settings/VoiceIdentityReviewPage.test.tsx
deno check src/components/audio/WaveformPlayer.tsx src/pages/settings/VoiceIdentityReviewPlayer.tsx src/pages/settings/VoiceIdentityReviewPage.tsx
```

Expected: focused tests pass and type-check exits 0.

### Task 4: Live reload and browser acceptance

**Files:**

- Modify only if live verification exposes a defect in the Task 1-3 files.

**Interfaces:**

- Produces: live, browser-verified `/settings/voice-identity` workflow.

- [ ] **Step 1: Verify runtime ownership and readiness**

Follow `DEVELOPMENT.md` readiness diagnostics. Confirm backend/frontend mounts
point to `~/repo/mycelia`, effective mode is `BACKEND_TASK=dev` and
`FRONTEND_MODE=dev`, `[READY]` is present, Compose services are healthy, and
`/readiness` succeeds. Recreate only a stale application service and restart
nginx if required.

- [ ] **Step 2: Exercise the real browser flow**

On `/settings/voice-identity`, verify one clip loads and plays, duration is
visible, missing score says `Not classified`, `This is me` advances and
autoplays, Undo restores the exact segment, `Not me` advances, Arrow shortcuts
work, the toggle persists across reload, and all progress displays update
coherently.

- [ ] **Step 3: Commit the implementation**

Stage only:

```bash
git add frontend/src/components/audio/WaveformPlayer.tsx \
  frontend/src/pages/settings/VoiceIdentityReviewPlayer.tsx \
  frontend/src/pages/settings/VoiceIdentityReviewPlayer.test.tsx \
  frontend/src/pages/settings/VoiceIdentityReviewPage.tsx \
  frontend/src/pages/settings/VoiceIdentityReviewPage.test.tsx \
  docs/superpowers/plans/2026-08-10-voice-identity-review-player.md
git commit -m "feat: add audio-first voice identity review"
```
