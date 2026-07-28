# Resource Registry - narrative notes (off-registry)

This file holds prose only. It is NOT imported by any gate. Do not put
machine fields in here.

Status of every registry file today: `design`. Reason: hard guard 22b
forbids treating design entries as live truth. We declare these as
target state. Before flipping any single resource to `active` we must:

1. The corresponding `v2/services/<owner>` module exists and is wired.
2. The `forbidden_paths` paths are physically removed from v1 (or the
   v1 import is gated by a red test that fails until removed).
3. The verification gate exists in `v2/gates/registry_gates/` and
   runs green in CI for the resource in question.

Three resources qualify as "v0" that survive into v2 unchanged:
- profile (truth is already ~right, just consolidate)
- progress_event (truth owner shift from utils/command-log.mjs to
  services/progress_event)
- error_envelope (already inside contracts/ in v2)

The other 13 resources each require at least one forbidden_path to be
physically removed from v1 before flipping status. We list these as
`forbidden_paths` already so the gate knows what to check.

Modules in v2 follow strict layer ordering. A module's id prefix is
its layer (e.g. `services.*` is L2). Cross-layer imports must resolve
through `edges.json`; anything else is a hard fail.
