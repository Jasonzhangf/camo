# camo fetch-page

Fetch a URL in the browser context bound to a target.

## Usage

```
camo fetch-page <url> [--timeout <ms>] [--target <t_id>] [--profile <id>]
```

`--target` is required when the profile has multiple active targets. The page
runtime receives the resolved internal page handle from the daemon.

## Wiring

- CLI: `commands/builtins/fetch-page.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active target (`camo start` first).
- A stale or cross-profile target fails explicitly.
- No fallback; first failure is reported.
