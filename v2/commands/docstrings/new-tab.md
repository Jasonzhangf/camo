# `camo new-tab`

OpenMinis-aligned browser action. See `camo new-tab --help` for usage.

## Wiring

- CLI: `commands/builtins/new-tab.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires active session (`camo start` first).
- No fallback; first failure is reported.
- Profile id must match `[a-zA-Z0-9._-]+`.
