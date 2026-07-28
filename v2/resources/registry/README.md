# Resource Registry - single truth of every resource in camo v2

Each row in `resources.json` declares exactly one resource. No resource may have more than one truth_owner. Reads must travel only via declared read_paths; writes must travel only via write_paths. Edges across modules go to `edges.json`.

When this file changes:
- Re-run `node v2/gates/registry_gates/run.mjs` (CI does it automatically on push).
- Update `v2/docs/wiki/resources.html` mirror.
- Add a verification entry in `v2/docs/verification/<gate_id>.md` if a new gate is introduced.

Path conventions in this directory:
- `resources.json`      machine truth (strict JSON, no prose in fields)
- `edges.json`          cross-module edges (only caller to callee, both as module_ids)
- `modules.json`        module inventory (owned_paths per module)
- `policies.json`       per-resource invariants (type-lock, no-fallback, etc.)
- `human_notes.md`      narrative, off-registry; never imported by gate
