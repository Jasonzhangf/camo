# Fix Design: Daemon Registration Locale Guard 20260812-r1

design_id: `FIX-camo-daemon-registration-locale-guard-20260812-r1`
status: `awaiting-approval`

## Trigger

The shared daemon registration is a single-process owner identified by `pid` +
`processIdentity`. Identity is derived from `ps -o lstart=` whose output
format follows the current process locale (`zh_CN.UTF-8` ->
`三  8月/12 11:39:11 2026`, `en_US.UTF-8` -> `Wed Aug 12 11:39:11 2026`).
`Node 22` `Date.parse` cannot normalize those locale strings; live daemons
recorded under a previous locale are misclassified as stale on the next
process boot, and `claimOwnerIsCurrent` lets a new daemon replace the
shared registration while the previous daemon still owns the runtime
profile lock.

## First divergence (evidence)

- Positive: `playground/camo-lifecycle-registration-lock-split/repro.mjs`
  isolated `HOME` boots a worker with `LANG=C` writing
  `darwin:Wed Aug 12 11:00:00 2026`. After the claim is rewritten to a
  legacy `darwin:三  8月/12 11:00:00 2026`, a second worker in the same
  locale replaces the claim (`canonicalClaimPid != firstPid`) while the
  first worker's profile lock remains on disk.
- Reverse: when `claimOwnerIsCurrent` is replaced with "the recorded PID is
  alive" the second worker is rejected with `E_STATE_DUPLICATE`. The
  divergence lives in identity comparison, not in the profile-lock owner.

## Unique owner and boundaries

- Resource: `daemon_registration`
- Truth owner: `v2/services/daemon_registration/registry.mjs`
- Caller boundaries: `v2/shell/daemon/index.mjs`,
  `v2/commands/builtins/daemon.mjs`, `v2/shell/bin_entry/index.mjs`
- Allowed paths:
  - `v2/services/daemon_registration/registry.mjs`
  - the existing integration suite
  - `v2/docs/feature_tests.json`, `v2/docs/mainline_call_map.json` if a
    registered edge needs to be added for the new test path
- Forbidden paths:
  - any other module or skill in this change set
  - silent fallback, caller-side retry, profile switching, or profile-lock
    cleanup in any module other than the existing daemon shutdown path
  - production `~/.camo` mutation; cleaning historical artifacts requires a
    separate approved plan

## Required implementation

1. Make Darwin process identity locale-independent: parse `ps -o lstart=`
   to a normalized UTC epoch and store `darwin:<epoch_ms>`. Keep the
   current `LANG=C` invocation.
2. Update `claimOwnerIsCurrent` to compare epoch millisecond values:
   `Date.parse(getProcessIdentity(pid)) === Date.parse(claim.processIdentity)`.
   If the recorded `processIdentity` cannot be parsed (legacy locale payload
   still alive), return `true` and refuse the takeover; only an
   `isProcessAlive` `false` allows the new daemon to advance through
   recovery.
3. Add positive and negative tests:
   - positive: legacy locale claim with a live PID is rejected with
     `E_STATE_DUPLICATE`; new epoch claim with the live PID is accepted.
   - negative: dead PID with any claim format is reclaimable; non-owner
     release still fails closed.
4. Update `feature_tests.json` `daemon.registration.read/write` rows and
   any `mainline_call_map.json` edge triggered by the new path. No symbol
   renames.
5. Regenerate `v2/docs/wiki/*.html` only if the JSON truth changed.

## Verification gates

- Positive and negative claim identity tests inside the existing
  `daemon-registration-claim.integration.test.mjs` plus one new file under
  `v2/tests/integration/`.
- `npm test`, `npm run test:all`, `npm run gates`, `npm run build`,
  `npm run check:file-size`.
- `npm pack --dry-run` and `npm install -g . --force` with a hash check
  of the installed `camo` against the packed source.
- A new canonical Claw replay using the global `camo` to navigate
  `/onestop/admin` with mouse/keyboard/wheel only and verify
  `camo get-page-info` on the live URL returns 200.
- A new Codex review via the fixed `oauth -> cc -> tcm` sequence; PASS only
  when the semantic verdict is explicit and no FAIL/P0/P1 finding remains.

## Approval gate

No main-worktree change, install, restart, or follow-up commit is
authorized until Jason explicitly approves
`FIX-camo-daemon-registration-locale-guard-20260812-r1`.
