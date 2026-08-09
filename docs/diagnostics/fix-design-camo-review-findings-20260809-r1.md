# Fix Design: Camo Review Findings 20260809-r1

## Status

`approved-by-jason`

This report records the post-review findings that block delivery of the
protocol closeout. The previously approved closeout design does not cover the
newly identified profile-routing, viewport-target selection, replacement-input,
failure-cleanup, and registration-mode defects; its approval therefore does
not authorize these changes.

## Evidence and root causes

1. A shared daemon discovered by the CLI is reused for every requested profile,
   while persistent `ensureBrowser()` retains the currently active profile.
   After profile A is opened, a command for profile B is routed to the same
   daemon but no B session exists, producing `E_STATE_NOT_FOUND` or an
   operation against the wrong active session. The unique owner is
   `v2/shell/daemon/index.mjs` profile/session routing.
2. `chooseVisibleLocator()` accepts any non-null bounding box. Off-screen
   duplicate matches can therefore win the smallest-area selection and then be
   scrolled into view, violating the viewport-filter contract. The unique owner
   is `v2/services/page_runtime/operations/interaction_ops.mjs`.
3. Selector-based `type` focuses with protocol mouse events and then appends
   with `keyboard.type()`. It no longer preserves the prior replacement
   semantics of `locator.fill()`, so existing input text can become `oldnew`.
   The unique owner is the same page-runtime interaction module. Replacement
   must remain protocol-level (keyboard selection/deletion), not DOM mutation.
4. `hover` is admitted as a browser command, but ephemeral cleanup runs only
   on the success path in `handleCommand()`. A failed hover leaks the browser,
   lock, and session. The unique owner is
   `v2/shell/daemon/index.mjs` command finalization.
5. The canonical registration schema stores `scope` and `headless` but not the
   daemon `mode`; `camo daemon status` consequently returns `mode: undefined`.
   The unique owner is `v2/services/daemon_registration/registry.mjs` plus its
   daemon status projection.

## Scope

In scope:

- Per-profile session routing inside the single shared daemon, with explicit
  profile isolation and no fallback to another profile.
- Viewport-aware visible-target selection.
- Protocol keyboard replacement semantics for selector-based typing.
- Failure-aware ephemeral cleanup with one physical cleanup owner.
- Canonical registration/status mode field and matching positive/negative tests.

Out of scope:

- OneStop business code or administrator authentication/recovery.
- DOM `click()`, `value=`, `fill()`, `scrollTo/scrollBy`, or JS user-action
  injection.
- Automatic retries, profile switching by callers, or compatibility fallback.
- New browser features unrelated to the findings above.

## Verification design

- Positive and negative tests for A/B profile isolation through one daemon.
- Positive and negative locator tests proving off-screen duplicates are skipped.
- Protocol call-order and replacement-key tests for selector typing.
- Ephemeral hover failure test proving browser/session/lock cleanup.
- Registration schema and daemon-status tests proving mode is persisted and
  projected exactly.
- Re-run `npm run gates`, `npm run test:all`, build, package dry-run, global
  install, canonical OneStop protocol replay, and a fresh Codex review.

## Approval gate

Jason approved design id `FIX-camo-review-findings-20260809-r1` on 2026-08-09.
