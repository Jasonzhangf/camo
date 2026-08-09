# Fix Design Report: CAMO-FIX-WIRE-CONTRACT-EPHEMERAL-OWNER-20260808-R1

## Scope

Close three protocol-chain defects that remain inside the approved camo
closeout: scroll delta projection, type response projection, and ephemeral
browser-command classification. OneStop code, search/platform behavior, and
page-operation action semantics are unchanged.

## Baseline reproduction

Isolated experiment worktree:
`/private/tmp/camo-wire-contract-exp-20260808` at base `166f66c`.

`node --test v2/tests/integration/daemon-wire-contract.integration.test.mjs`
produces three deterministic failures:

- Scroll CLI sends `{dx:17,dy:91}` but protocol wheel receives `[0,0]`.
- A malformed type response without a count is projected as `typedChars=5`
  from the request text.
- The intended shared browser-command owner module is absent; handler startup
  and daemon cleanup maintain separate sets, and the cleanup set omits hover.

## First divergence and causal proof

1. Scroll first diverges in
   `v2/shell/daemon/command_handlers.mjs::handleCommand`: the builtin owns wire
   fields `dx/dy`, while the handler reads `x/y` and silently substitutes zero.
2. Type first diverges at the same daemon projection: page runtime returns
   `length`, the daemon returns `length`, but the builtin consumes
   `typedChars` and reconstructs a success count from request text.
3. Ephemeral cleanup first diverges between two literal command sets in
   `command_handlers.mjs` and `daemon/index.mjs`; hover is admitted by the
   former but excluded by the latter.

The isolated baseline and direct source comparison are the reverse evidence.
The approved positive intervention is locked by the same three tests: canonical
`dx/dy` must reach wheel unchanged, canonical `typedChars` must be returned by
the daemon and never reconstructed by the builtin, and both lifecycle sites
must query one command-classification owner.

## Unique owners and boundaries

- Wire translation/projection owner:
  `v2/shell/daemon/command_handlers.mjs::handleCommand`
- Browser-command classification owner:
  `v2/shell/daemon/browser_commands.mjs`
- CLI consumer:
  `v2/commands/builtins/type.mjs`
- Allowed paths:
  - `v2/shell/daemon/command_handlers.mjs`
  - `v2/shell/daemon/index.mjs`
  - `v2/shell/daemon/browser_commands.mjs`
  - `v2/commands/builtins/type.mjs`
  - `v2/tests/integration/daemon-wire-contract.integration.test.mjs`
  - architecture maps, generated projections, and verification docs
- Forbidden paths:
  - accepting both `x/y` and `dx/dy`
  - reconstructing response truth from request text
  - caller-side cleanup or retry
  - OneStop source or XHS/search behavior

## Approved implementation

- Preserve `dx/dy` as the canonical wire fields and map them exactly once to
  the page-runtime `x/y` operation parameters in the daemon.
- Project runtime `length` as wire `typedChars`; the builtin consumes the
  required field without fallback.
- Export one immutable browser-command set plus `isBrowserCommand()` from the
  daemon module and use it for both browser admission and ephemeral cleanup.

## Required verification

- Isolated red tests above turn green in the clean-fix tree.
- Existing protocol interaction, scroll input, readable, daemon registration,
  shutdown-policy, and builtin roundtrip tests stay green.
- Architecture maps and gates name the actual daemon owner and commands.
- Full tests/build/pack/global install/canonical OneStop replay and fresh Codex
  review PASS follow the parent closeout plan.

## Approval

Jason's prior repeated `批准` and instruction to continue the camo closeout
cover this design because it removes verified gaps inside the same protocol
chain without changing owner, base intent, business scope, or action boundary.
