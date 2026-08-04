# Camo 0.3.6 Release Test Design

## Lifecycle mainline

One daemon registration identifies one shared runtime. Requests select a
`profileId`; the daemon owns a map of independent profile lifecycles. Named
profiles persist until explicit profile stop. Ephemeral profiles are created
for one command and fully removed after that command.

## White-box coverage

- Daemon registration parser rejects malformed records and stale processes.
- Registration writes and deletes have one owner.
- Concurrent startup claims produce exactly one shared-daemon winner.
- A claim is published only after its complete owner record is durable; no
  reader can observe an empty or partial canonical claim.
- Stale-claim takeover is serialized by a recovery claim and revalidates the
  observed owner token before removing stale truth.
- A recovery owner crash cannot permanently block startup. The next contender
  verifies the recovery PID + process-start identity, removes only dead recovery
  truth while holding the recovery mutex, and then completes canonical takeover.
- Active registration and startup ownership are one canonical state record,
  so shutdown cannot half-delete registration and claim truth.
- Concurrent CLI daemon starts produce at most one `started` result; the loser
  reports an explicit duplicate/already-running outcome and never combines its
  child PID with the winner's ports.
- Command failure remains primary when ephemeral cleanup also fails.
- Ephemeral command cleanup executes exactly once after command execution,
  regardless of command success or failure. Cleanup failure is never retried
  against partially mutated browser/session/lock truth.
- A child daemon signal or non-zero exit makes the CLI fail.
- Browser locks and input state are keyed by profile.
- Complete and partial Camoufox handles remain owned until close succeeds.
- Shutdown and explicit stop wait for every in-flight profile start; a browser
  that finishes launching during teardown is closed before teardown succeeds.
- Same-profile actions serialize; different profiles do not share state.

## Module black-box coverage

- One daemon can start two named profiles and report both sessions.
- `start --url` navigates the new profile before returning success; omission of
  `--url` leaves the profile on its browser-default page.
- Stopping profile A leaves profile B operational.
- Ephemeral profile cleanup removes browser, session, lock, metadata, and run
  artifacts without stopping named profiles hosted by the daemon.
- Ephemeral `start` on an already-running shared daemon is request-scoped and
  leaves no profile, lock, session, or browser instance.
- Daemon shutdown closes every profile and removes its one registration only
  after both protocol servers have closed.
- Daemon shutdown terminates active HTTP/WS connections before awaiting
  listener closure, so a connected client cannot retain the daemon process or
  canonical registration.
- Browser shutdown failure aborts teardown before registration release or
  server closure; successful browser shutdown proceeds in the fixed order
  `browser -> lifecycle truth -> servers -> registration`.

## Project black-box coverage

- Packed, globally installed `camo` performs a real browser screenshot.
- Two named profiles use the same daemon PID/WS/HTTP endpoint and isolated
  browser data.
- All test suites run with a temporary `HOME` and leave the real `~/.camo`
  unchanged.

## Negative paths

- Duplicate start of one profile is rejected.
- Duplicate browser launch is rejected before another browser is created.
- Partial launch cleanup failure retains browser ownership and profile lock
  truth.
- Unknown daemon teardown result, non-zero exit, and signal exit are failures.
- Registration schema/import graph/function map drift fail a build gate.
- Daemon-registration write-owner prohibitions reject named, namespace,
  re-export, dynamic import, static template import, and query/fragment ESM
  access outside the registered writer path. Non-static dynamic imports fail
  closed because their ownership target cannot be proven.
- The global cross-module import graph and per-resource `import_module`
  prohibitions consume one shared AST import-specifier extractor. Static
  declarations, re-exports, quoted/template dynamic imports, and
  query/fragment specifiers resolve through the same path; non-static dynamic
  targets fail closed in both gates.
- Function-map and mainline-call-map Markdown/wiki projections are exact
  generated views of their JSON truth, including local symbols and every
  callback invocation binding field.
- Generic builtin registry dispatch is represented as two adjacent call-map
  edges: shell dispatcher to builtin registry dispatcher, then registry
  dispatcher to the selected concrete builtin. Gate validation binds the
  concrete namespace import, registry member, selector, dispatch variable, and
  invoked method.
- PID reuse cannot make stale registration active because process start
  identity, claim token, and registration identity must agree.
- Cleanup errors remain secondary and cannot replace the command error.
- Removing any mapped resource write edge from that resource's
  `indirect_paths` makes the registry gate fail.

## Rust migration plan

- Target chain: `DaemonLifecycleIn01Claim -> DaemonLifecycleIn02IdentityCheck
  -> DaemonLifecycleIn03ActiveRegistration -> DaemonLifecycleOut04Shutdown`.
- Rust will own claim/recovery state transitions, PID-generation identity
  validation, and shutdown-state decisions. The JavaScript
  `services/daemon_registration` module remains the temporary filesystem and
  process-IO bridge until the Rust owner exposes the compiled contract.
- Migration must preserve the current JSON schema and mainline node IDs, add
  contract fixtures for claimed/active/stale/terminal states, switch the
  JavaScript bridge to the Rust contract, then physically remove JavaScript
  semantic decisions after installed-artifact parity passes.

## Known boundary

Publishing to npm and deleting pre-existing user runtime residue require
explicit authorization and are outside automated test cleanup.
