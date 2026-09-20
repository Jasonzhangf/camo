# `camo hover`

Hover an element in a target's page.

Usage:
```
camo hover --selector <css>|--text <text> [--target <t_id>] [--profile <id>]
```

`--target` is the stable handle returned by `start`. When omitted, a profile
with exactly one active target is selected; multiple active targets are an
explicit ambiguity error.

## Wiring

- CLI: `commands/builtins/hover.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires active session (`camo start` first).
- A stale target or a target from another profile is rejected explicitly.
- Concurrent actions for the same profile return `E_STATE_LOCKED`.
- No fallback; first failure is reported.
- Profile id must match `[a-zA-Z0-9._-]+`.
