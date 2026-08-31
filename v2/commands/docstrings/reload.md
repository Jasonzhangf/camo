# `camo reload`

Reload the active page.

## Usage

```
camo reload [--wait-until <waitUntil>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--wait-until` | enum | No | `load` (default), `domcontentloaded`, `networkidle`, `commit` |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Reload the active page
camo reload --profile my-profile
```

## Wiring

- CLI: `commands/builtins/reload.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the profile already started.
- No fallback; first failure is reported.
- `wait-until` must be one of the allowed enum values.
