# Fix Design Report: CAMO-FIX-SET-VIEWPORT-WIRE-PROJECTION-20260809-R1

## Scope

Close the `set-viewport` response-projection defect discovered during the
approved canonical desktop/mobile replay. This stays inside the camo protocol
closeout and does not change OneStop code, browser viewport semantics, or any
platform-specific behavior.

## Baseline reproduction

Isolated experiment worktree:
`/private/tmp/camo-set-viewport-wire-exp-20260808` at base `166f66c`.

The global command successfully changed the real screenshot from 1440x1080 to
390x844, while its CLI result reported `set:false`. The deterministic contract
test reproduced both defects:

- the daemon emitted `viewportSet:true` although the builtin consumes `set`;
- the builtin accepted a success-shaped response without canonical `set`,
  `width`, or `height` truth.

## First divergence and causal proof

The first divergence is
`v2/shell/daemon/command_handlers.mjs::handleCommand`: the runtime returns
`{ set, width, height }`, but the daemon replaces that contract with
`{ viewportSet:true }`. The builtin then silently converts the absent `set`
field into `false` instead of rejecting malformed response truth.

Reverse evidence is the unchanged baseline test failure. Positive intervention
in the experiment projects the runtime fields unchanged and makes the builtin
require exact request/response agreement; both positive and negative tests pass.

## Unique owners and boundaries

- Runtime result owner: `v2/services/page_runtime/operations/config_ops.mjs::setViewport`
- Daemon projection owner: `v2/shell/daemon/command_handlers.mjs::handleCommand`
- CLI consumer: `v2/commands/builtins/setViewport.mjs::run`
- Allowed paths:
  - `v2/shell/daemon/command_handlers.mjs`
  - `v2/commands/builtins/setViewport.mjs`
  - `v2/tests/integration/set-viewport-wire-contract.integration.test.mjs`
  - architecture/verification projections if required by gates
- Forbidden paths:
  - accepting both `viewportSet` and `set`
  - reconstructing success from request fields
  - OneStop source, DOM viewport injection, or caller-side compensation

## Approved implementation

- Project runtime `set`, `width`, and `height` through the daemon response.
- Require exact `set:true` and requested dimensions in the builtin; malformed or
  mismatched response truth fails as `E_PROTO_BAD_ENVELOPE`.
- Add paired positive/negative integration coverage.

## Required verification

- The isolated red test turns green with the intervention and remains red on the
  unmodified base.
- Existing wire, config, business, integration, e2e, registry, build, pack, and
  file-size gates stay green.
- Reinstall from a real tarball, restart the exact daemon, and repeat canonical
  390x844 replay; the global command must report `set:true` and screenshot size
  must match.
- Fresh Codex review PASS follows the parent closeout plan.

## Approval status

`APPROVED_BY_JASON_20260809`.
