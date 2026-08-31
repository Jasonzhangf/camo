# Fix Design: Camo Lifecycle Review Gaps 20260809-r1

Design ID: `FIX-camo-lifecycle-review-gaps-20260809-r1`

## Status

`approved-by-jason`

## Trigger and review result

The mandatory review of commit `f4663a04ebb436039bd9bb6176c3fd8b67226a13`
did not produce a valid verdict. The `cc` channel ended without a final
message, `asxs` returned 503, and `tcm` exited with only analysis text. The
review gate therefore remains failed: there is no `VERDICT: PASS` and no
unambiguous semantic PASS.

The incomplete `tcm` analysis exposed two reproducible defects inside the
closeout lifecycle and wait contracts. The mandatory OpenCode fallback then
completed with `VERDICT: FAIL` and two P1 findings: an undeclared daemon-to-
internal browser edge and a dead daemon-finder compatibility facade. These
findings were diagnosed in the isolated
worktree `/private/tmp/camo-review-findings-exp-20260809` at base `f4663a0`.
No experiment patch was applied to the main worktree or deployed runtime.

## Baseline reproduction and first divergence

### 1. Multi-profile manager locks are not owned per profile

The shared daemon can keep profile A and profile B active simultaneously, but
`v2/services/browser_service/bootstrap.mjs` stores one `_lockHandle` and one
`_currentProfile`. Starting B overwrites A's ownership state. The first
divergence is therefore the second successful `startSession`: runtime/session
truth contains A and B, while bootstrap lock ownership contains only B.

The isolated real-Camoufox reproduction started two profiles and observed:

```text
before shutdown:
sessions = [profile_a, profile_b]
manager locks = [profile_a.lock.json, profile_b.lock.json]

after shutdown at baseline f4663a0:
sessions = []
manager locks = [profile_a.lock.json]
```

Red test:

```text
node --test v2/tests/integration/browser-multi-profile-lock-lifecycle.integration.test.mjs
FAIL: expected no manager locks after shutdown; profile_a.lock.json remained
```

Positive intervention replaced the singleton experiment state with a
profile-keyed lock map and made shutdown release every owned profile lock. The
same test passed. Reverting only that intervention made it fail again. This
confirms the unique owner and causal change point.

Unique owner: `services.browser_service`, specifically
`v2/services/browser_service/bootstrap.mjs`.

### 2. `wait --ms` bypasses the registered CLI contract

Business tests call `camo wait --ms 200/300`, and page runtime accepts `ms`,
but `v2/commands/registry/registry.json` does not declare the field and
`v2/commands/builtins/wait.mjs` does not send it. The parser retains unknown
flags as unvalidated strings, so the first divergence is the registry parser:
`parsed.named.ms` is `"250"`, negative values produce no input error, and the
builtin omits `args.ms` from the wire payload.

Red tests:

```text
node --test v2/tests/unit/commands/wait-duration-contract.test.mjs
FAIL: "250" !== 250
FAIL: negative --ms produced no parser error
```

Positive intervention declared `ms` as a non-negative integer in the command
registry and projected it through the wait builtin. Both tests passed.
Reverting only that intervention made both fail again.

Unique owners:

- CLI input schema: `v2/commands/registry/registry.json`
- CLI-to-wire projection: `v2/commands/builtins/wait.mjs`
- Runtime wait semantics remain in
  `v2/services/page_runtime/operations/wait_ops.mjs`; no duplicate timer owner
  will be added.

### 3. Shared-daemon routing crosses the registered browser-service boundary

`v2/shell/daemon/index.mjs::ensureBrowser` dynamically imports
`services/browser_service/internal/camoufox_bridge.mjs::getBrowser`. The module
registry permits `shell.daemon -> services.browser_service`, while browser
runtime handles are explicitly owned behind
`services.browser_service -> services.browser_service.internal`. Because the
edge is a dynamic import, the current static import gate did not reject it.

The unique semantic need is only "does this profile already have an active
browser session?" `services.browser_service/bootstrap.mjs` already owns the
profile lifecycle facade and exposes `getSession`/`listSessions`. The daemon
must query that owner rather than read the internal browser record directly.

Unique owners:

- profile lifecycle query: `v2/services/browser_service/bootstrap.mjs`
- shared daemon orchestration: `v2/shell/daemon/index.mjs`
- import-edge enforcement: `v2/tests/unit/docs/generated_maps.test.mjs`

### 4. Daemon finder is a dead compatibility facade

`v2/shell/config/daemon_finder.mjs` has no runtime or test importer. Active
callers now import the canonical `services.daemon_registration` owner directly.
The facade also advertises profile/ephemeral filtering while its implementation
only forwards `pid`, so retaining it preserves dead and misleading semantics.

Unique action: physically delete `daemon_finder.mjs` and remove its README
entry. No replacement facade or compatibility fallback will be created.

## Root-cause conclusion

The defects share one architectural error: cardinality changed from one active
profile/one wait mode to multi-profile/dual wait mode, but the owning contracts
were not changed at the same boundary. The fix must change the owners' types
and registered fields, not add daemon cleanup compensation, caller retries, or
unknown-flag tolerance.

## Approved implementation scope

After Jason approves this exact design ID:

1. Replace bootstrap singleton lock/current-profile truth with a profile-keyed
   ownership map. `startSession`, launch rollback, `stopSession`, shutdown, and
   test reset must mutate the same map by exact profile ID.
2. Preserve teardown ordering: browser handles close first; manager locks are
   released only for profiles whose lifecycle owner is being torn down. A
   release error remains explicit and must not be converted to successful
   shutdown.
3. Add positive and negative tests for two active profiles, targeted stop, full
   shutdown, launch rollback, and no cross-profile release.
4. Declare `wait --ms` in the command registry as a non-negative integer and
   project it unchanged through the builtin and daemon to the existing runtime
   owner. Add tests for valid zero/positive values, negative/non-integer input,
   and exact wire projection.
5. Add the lifecycle features and required tests to
   `v2/docs/feature_tests.json`; update function/mainline JSON only if symbols
   or adjacent calls change; regenerate Markdown/wiki projections with the
   canonical generator.
6. Wire maintained business coverage into `test:all`, or physically replace
   stale business tests with maintained contract tests. The final required
   suite may not silently omit the repository's `wait --ms` contract.
7. Remove the daemon's dynamic import of the internal Camoufox bridge. Add the
   exact lifecycle query to the browser-service facade only if the existing
   `getSession`/`listSessions` contract cannot express it without ambiguity;
   preserve the registered `shell.daemon -> services.browser_service` edge.
8. Extend the import graph gate to fail closed on static-string dynamic imports
   using the existing AST extractor; add a negative fixture for
   `shell.daemon -> services.browser_service.internal`.
9. Physically delete the unreferenced
   `v2/shell/config/daemon_finder.mjs` facade and its README description.

## Explicitly out of scope

- OneStop business or authentication code.
- DOM click, value assignment, `fill()`, JS scrolling, or JS user-action
  injection.
- Retry, fallback, profile switching in callers, or cleanup compensation in
  the daemon.
- The pre-existing aggressive process policy in
  `browser_service/internal/ProfileLock.mjs`; it requires a separate owner and
  design audit if changed.
- Unproven WebSocket concurrency redesign. Concurrency will receive a focused
  red/green audit; implementation expands only if a deterministic first
  divergence is reproduced and the design is re-approved.
- OpenCode P2 suggestions about changing ephemeral cleanup error precedence or
  stale-registration recovery. The current architecture intentionally keeps
  cleanup failure explicit and daemon-registration recovery owned by the
  canonical claim state machine. Those behaviors require independent evidence
  before any semantic change.

## Verification gates after implementation

1. Architecture pre/post audit against resource, module, edge, function,
   mainline, and feature-test maps.
2. Focused lifecycle and wait positive/negative tests, including real
   two-profile Camoufox shutdown evidence in an isolated home.
3. `npm run gates`, `npm test`, `npm run test:all`, `npm run build`, and
   `npm run check:file-size` with no failure or timeout.
4. `npm pack --dry-run --json`, `npm install -g . --force`, global binary/version
   and installed-source hash checks.
5. A fresh global-Camo canonical OneStop desktop/mobile protocol replay using
   mouse, keyboard, and wheel only.
6. A new Codex review. Any code/test/build/runtime-config change after PASS
   invalidates it and repeats the affected gates, install, replay, and review.

## Approval gate

No main-worktree implementation, install, deployment, or follow-up commit is
authorized until Jason explicitly approves
`FIX-camo-lifecycle-review-gaps-20260809-r1`.
