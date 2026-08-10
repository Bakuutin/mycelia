# Frontend Popup Replacement Design

## Goal

Remove browser-native `alert`, `confirm`, and `prompt` calls from the Mycelia
frontend. Every operation must remain usable by keyboard, screen readers, and
browser automation without a blocking browser dialog.

## UX contract

- Success and error feedback uses the existing Sonner toast system.
- Reversible actions run immediately. Their trigger shows an inline pending
  state and is disabled while the request is in flight.
- Destructive or interrupting actions open an application-owned confirmation
  dialog with an explicit title, consequence text, Cancel, and action button.
- High-risk deletion and purge actions use the same dialog plus a required
  confirmation phrase. The destructive button remains disabled until it
  matches exactly.
- Form validation remains inline where the relevant form is already visible;
  toast is reserved for request-level outcomes.

## Components

Add a reusable controlled `ActionConfirmDialog` built on the existing Radix
Dialog primitives. It supports:

- title, description, cancel/action labels;
- normal or destructive action styling;
- optional exact confirmation phrase and input label;
- pending state owned by the caller;
- `onConfirm` callback without closing early while pending.

Pages keep their mutation logic. They only replace native popup branches with
dialog state or toast callbacks. This avoids a global imperative popup API and
keeps each operation's consequences visible next to its owning UI.

## Migration scope

Replace every frontend source occurrence of native popup APIs, including Jobs,
Job Detail, Audio Pipeline, Summary History, Voice Identity purge, object and
relationship deletion, location imports/geotags, provider and API settings,
and recording permission errors.

Bulk queue deletion, reset, cancel, credential revoke, provider deletion, and
purge flows require application dialogs. Routine worker/job failures and
success counts use toasts. Existing browser-native dialogs must not remain in
`frontend/src` after migration.

## Error handling and accessibility

- Mutation failure keeps a confirmation dialog open when retry is useful and
  shows a toast containing the server error.
- Dialog title/description are associated through Radix primitives.
- Initial focus goes to Cancel for destructive operations; confirmation-phrase
  dialogs focus the input.
- Buttons expose pending text such as `Deleting…` or `Queueing…`.

## Testing and acceptance

- Unit-test confirmation phrase matching and action enablement.
- Component-test normal confirmation, destructive confirmation, typed phrase,
  cancel, and pending behavior.
- Run focused page tests plus frontend type-check/build.
- Static scan must return no calls to `alert`, `confirm`, or `prompt` under
  `frontend/src`.
- Browser smoke-test at least Job rerun, one destructive confirmation, and one
  typed purge/delete confirmation without native popup interception.
