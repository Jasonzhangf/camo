# `camo get-page-info`

OpenMinis-aligned browser action. See `camo get-page-info --help` for usage.

## Wiring

- CLI: `commands/builtins/get-page-info.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires active session (`camo start` first).
- No fallback; first failure is reported.
- Profile id must match `[a-zA-Z0-9._-]+`.
