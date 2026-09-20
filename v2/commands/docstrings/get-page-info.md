# `camo get-page-info`

OpenMinis-aligned browser action. See `camo get-page-info --help` for usage.

## Wiring

- CLI: `commands/builtins/get-page-info.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active target returned by `camo start`, `new-tab`, or
  `multi-open`; use `--target <t_id>` when the profile has more than one.
- A stale or cross-profile target fails explicitly.
- No fallback; first failure is reported.
- Profile id must match `[a-zA-Z0-9._-]+`.
