# Fix Design Report: CAMO-FIX-DAEMON-REGISTRATION-WIRING-20260808-R1

## Scope

Restore the existing canonical `services.daemon_registration` owner to the
live daemon startup/shutdown path. Do not change profile selection, browser
commands, ports, or OneStop behavior.

## Baseline reproduction

`node --test v2/tests/integration/daemon-registration-claim.integration.test.mjs`
passes the three direct registry tests, then hangs in `concurrent daemon
starts`. The child process and one detached `concurrent-b` daemon remain alive.
Repeated runs leave additional `concurrent-b` daemons.

## First divergence and root cause

The machine maps and resource registry bind daemon startup to
`claimDaemonSlot -> registerDaemon` and shutdown to
`unregisterDaemon/releaseDaemonSlot`. The live
`v2/shell/daemon/index.mjs`, however, defines a second ad-hoc per-profile JSON
registration implementation and never imports the canonical owner. Therefore
both concurrent children can start, the test stops only the profile-A daemon,
and the profile-B child retains its event handles indefinitely.

This is the first divergence: transport daemon startup bypasses the declared
`services.daemon_registration` owner.

## Unique owner and boundaries

- Resource: `daemon_registration`
- Truth owner: `v2/services/daemon_registration/registry.mjs`
- Orchestrator caller: `v2/shell/daemon/index.mjs`
- Allowed paths:
  - `v2/shell/daemon/index.mjs`
  - `v2/commands/builtins/daemon.mjs`
  - `v2/services/daemon_registration/registry.mjs` only if an existing owner
    contract defect is proven
  - existing claim integration test and architecture projections
- Forbidden paths:
  - a second registration directory or file shape
  - per-profile startup ownership
  - test-only process killing as the product fix
  - fallback to ad-hoc registration scanning

## Approved implementation

The daemon claims the single shared slot before opening listeners, atomically
promotes that claim to active after both ports listen, and releases the same
claim on startup failure or unregisters it on successful shutdown. CLI daemon
discovery consumes the canonical registration owner. The loser fails explicitly
or reports the already-running winner; it cannot remain detached.

## Required verification

- Direct claim positive/negative/stale recovery tests.
- Concurrent CLI daemon starts: exactly one winner, no loser daemon remains,
  and the subprocess exits.
- Registration file is removed only after successful shutdown.
- Full integration and `test:all` have no timeout.
- Global install plus persistent multi-profile live replay uses one daemon
  registration and leaves no task-owned daemon after explicit stop.

## Approval

Jason's prior repeated `批准` / `继续` authorization covers this current
closeout design while the owner, base, scope, and registration contract remain
exactly as specified above.
