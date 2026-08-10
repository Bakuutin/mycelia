# Frontend Popup Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every browser-native `alert`, `confirm`, and `prompt` in `frontend/src` with accessible React dialogs, inline pending states, and Sonner toasts.

**Architecture:** A reusable controlled `ActionConfirmDialog` owns confirmation UI and optional exact-phrase input while page components retain their mutations. A source-scan test prevents native popup APIs from returning. Simple result messages migrate directly to Sonner.

**Tech Stack:** React 19, TypeScript, Radix Dialog, existing shadcn-style UI primitives, Sonner, Vitest, Testing Library.

## Global Constraints

- Success and error feedback uses Sonner toast.
- Reversible actions execute without confirmation and show inline pending state.
- Destructive or interrupting actions require an application-owned Dialog.
- High-risk deletion and purge require an exact confirmation phrase inside the Dialog.
- No call to browser-native `alert`, `confirm`, or `prompt` may remain under `frontend/src`.
- Preserve existing backend requests, payloads, and confirmation strings.

---

### Task 1: Reusable confirmation dialog

**Files:**
- Create: `frontend/src/components/ActionConfirmDialog.tsx`
- Create: `frontend/src/components/ActionConfirmDialog.test.tsx`
- Reuse: `frontend/src/components/ui/dialog.tsx`

**Interfaces:**
- Produces: `ActionConfirmDialog(props)` with `open`, `onOpenChange`, `title`, `description`, `actionLabel`, `pendingLabel`, `destructive`, `pending`, `confirmationPhrase`, `confirmationLabel`, and `onConfirm`.
- Behavior: Cancel closes only when not pending; action is disabled while pending or phrase mismatch; destructive dialogs autofocus Cancel, phrase dialogs autofocus input.

- [ ] **Step 1: Write failing component tests**

Test normal confirm/cancel, exact phrase enablement, destructive styling, and pending text using Testing Library. Use a real click handler and assert it is not called before phrase equality.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && deno task test --run src/components/ActionConfirmDialog.test.tsx`

Expected: FAIL because `ActionConfirmDialog` does not exist.

- [ ] **Step 3: Implement the controlled dialog**

Compose `Dialog`, `DialogContent`, `DialogHeader`, `DialogDescription`, `DialogFooter`, `Button`, `Input`, and `Label`. Reset entered text when `open` becomes false. Invoke `onConfirm` without closing; the caller closes after mutation success.

- [ ] **Step 4: Verify GREEN**

Run: `cd frontend && deno task test --run src/components/ActionConfirmDialog.test.tsx`

Expected: all dialog tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ActionConfirmDialog.tsx frontend/src/components/ActionConfirmDialog.test.tsx
git commit -m "feat: add accessible action confirmation dialog"
```

### Task 2: Jobs and job-detail popup migration

**Files:**
- Modify: `frontend/src/pages/JobsPage.tsx`
- Modify: `frontend/src/pages/JobDetailPage.tsx`
- Create: `frontend/src/pages/jobsPopupFlows.test.tsx`

**Interfaces:**
- Consumes: `ActionConfirmDialog` from Task 1.
- Produces: dialog state for queue clear/reset/cancel/retry bulk operations; immediate `Run again`; toast feedback for every mutation outcome.

- [ ] **Step 1: Write failing behavior tests**

Cover: rerun does not call `globalThis.confirm`; cancel opens an application dialog; typed completed-job deletion keeps action disabled until its existing phrase matches; mutation errors call Sonner rather than `alert`.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && deno task test --run src/pages/jobsPopupFlows.test.tsx`

Expected: FAIL on native popup calls or missing dialog roles.

- [ ] **Step 3: Replace native calls**

Convert the JobsPage occurrences around worker pause/resume/restart, retry, queue clear/reset, cancel-all, completed-job deletion, and service route actions. Use toast success/error callbacks; use `ActionConfirmDialog` for actions that currently call `confirm`; keep the exact existing deletion phrase in `confirmationPhrase`.

- [ ] **Step 4: Verify GREEN and type safety**

Run: `cd frontend && deno task test --run src/pages/jobsPopupFlows.test.tsx && deno check src/pages/JobsPage.tsx src/pages/JobDetailPage.tsx`

Expected: tests PASS and check exits 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/JobsPage.tsx frontend/src/pages/JobDetailPage.tsx frontend/src/pages/jobsPopupFlows.test.tsx
git commit -m "fix: replace jobs browser popups with app feedback"
```

### Task 3: Destructive page and settings confirmations

**Files:**
- Modify: `frontend/src/pages/ObjectDetailPage.tsx`
- Modify: `frontend/src/components/RelationshipsPanel.tsx`
- Modify: `frontend/src/components/location/GeotagsSheet.tsx`
- Modify: `frontend/src/components/location/ImportsList.tsx`
- Modify: `frontend/src/pages/settings/ProvidersSettingsPage.tsx`
- Modify: `frontend/src/pages/settings/APISettingsPage.tsx`
- Create: `frontend/src/lib/actionConfirmation.test.ts`

**Interfaces:**
- Consumes: `ActionConfirmDialog`.
- Produces: controlled dialog state at each delete/revoke/reset owner; mutation callbacks close on success and keep UI usable on failure.

- [ ] **Step 1: Write failing confirmation-contract tests**

Add source-level assertions that these seven owners import `ActionConfirmDialog` and contain no native popup identifiers. Add focused component tests where existing fixtures make rendering practical: provider deletion and API-key revocation.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && deno task test --run src/lib/actionConfirmation.test.ts`

Expected: FAIL listing owners that still call native confirmation.

- [ ] **Step 3: Migrate each owner**

Store the selected entity/key/import in state, render one dialog per owner, and call the existing mutation only from `onConfirm`. Use destructive styling for delete/revoke and normal styling for credential reset. Add pending labels derived from the operation.

- [ ] **Step 4: Verify GREEN**

Run: `cd frontend && deno task test --run src/lib/actionConfirmation.test.ts && deno check src/pages/ObjectDetailPage.tsx src/components/RelationshipsPanel.tsx src/components/location/GeotagsSheet.tsx src/components/location/ImportsList.tsx src/pages/settings/ProvidersSettingsPage.tsx src/pages/settings/APISettingsPage.tsx`

Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ObjectDetailPage.tsx frontend/src/components/RelationshipsPanel.tsx frontend/src/components/location/GeotagsSheet.tsx frontend/src/components/location/ImportsList.tsx frontend/src/pages/settings/ProvidersSettingsPage.tsx frontend/src/pages/settings/APISettingsPage.tsx frontend/src/lib/actionConfirmation.test.ts
git commit -m "fix: move destructive confirmations into React dialogs"
```

### Task 4: Pipeline, history, voice purge, and permission feedback

**Files:**
- Modify: `frontend/src/pages/AudioPipelinePage.tsx`
- Modify: `frontend/src/pages/SummaryHistoryPage.tsx`
- Modify: `frontend/src/components/VoiceIdentityOperations.tsx`
- Modify: `frontend/src/hooks/useAudioRecording.ts`
- Create: `frontend/src/lib/remainingPopupFlows.test.ts`

**Interfaces:**
- Consumes: `ActionConfirmDialog` and Sonner toast.
- Produces: explicit pipeline/history confirmation dialogs, `PURGE <runId>` phrase dialog, and toast-based microphone permission failure.

- [ ] **Step 1: Write failing tests**

Assert the voice purge action submits exactly `PURGE ${runId}` only after phrase match. Assert microphone denial reports through toast. Assert Audio Pipeline and Summary History expose dialog titles instead of invoking native confirm.

- [ ] **Step 2: Verify RED**

Run: `cd frontend && deno task test --run src/lib/remainingPopupFlows.test.ts`

Expected: FAIL because native APIs remain.

- [ ] **Step 3: Implement migrations**

Move selected run/range/history action into controlled state. Preserve the server payload field `confirmation`. Replace microphone permission `alert` with `toast.error("Microphone permission denied. Please enable it in your browser settings.")`.

- [ ] **Step 4: Verify GREEN**

Run: `cd frontend && deno task test --run src/lib/remainingPopupFlows.test.ts && deno check src/pages/AudioPipelinePage.tsx src/pages/SummaryHistoryPage.tsx src/components/VoiceIdentityOperations.tsx src/hooks/useAudioRecording.ts`

Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AudioPipelinePage.tsx frontend/src/pages/SummaryHistoryPage.tsx frontend/src/components/VoiceIdentityOperations.tsx frontend/src/hooks/useAudioRecording.ts frontend/src/lib/remainingPopupFlows.test.ts
git commit -m "fix: replace remaining workflow popups"
```

### Task 5: Global regression guard and live verification

**Files:**
- Create: `frontend/src/lib/noNativeBrowserPopups.test.ts`
- Modify only if failures reveal a missed caller under: `frontend/src/**`

**Interfaces:**
- Produces: permanent source-scan regression test covering `.ts` and `.tsx` files excluding tests and `components/ui` primitives.

- [ ] **Step 1: Write the source-scan test**

Recursively scan `frontend/src` with `node:fs`; fail when production source matches `/(?:globalThis\.|window\.)?(?:alert|confirm|prompt)\s*\(/`.

- [ ] **Step 2: Verify the guard**

Run: `cd frontend && deno task test --run src/lib/noNativeBrowserPopups.test.ts`

Expected: PASS only after Tasks 2–4 migrated every caller.

- [ ] **Step 3: Run full focused verification**

Run:

```bash
cd frontend
deno task test --run src/components/ActionConfirmDialog.test.tsx src/pages/jobsPopupFlows.test.tsx src/lib/actionConfirmation.test.ts src/lib/remainingPopupFlows.test.ts src/lib/noNativeBrowserPopups.test.ts
deno task type-check
deno task build
```

Expected: all tests PASS; type-check and production build exit 0.

- [ ] **Step 4: Verify the static invariant independently**

Run: `rg -n --glob 'frontend/src/**' '\b(window\.|globalThis\.)?(alert|confirm|prompt)\s*\(' frontend/src`

Expected: no output.

- [ ] **Step 5: Recreate frontend and browser-smoke the UI**

Follow `DEVELOPMENT.md` readiness/reload diagnostics. Verify bind mount and `FRONTEND_MODE`; rebuild/recreate only frontend if production mode, restart nginx, then test Job rerun, a destructive Cancel/Confirm dialog, and typed Voice Identity purge without native dialog interception.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/noNativeBrowserPopups.test.ts
git commit -m "test: prevent native frontend popups"
```
