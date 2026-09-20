# `camo reload`

Reload a target's page.

## Usage

```
camo reload [--target <t_id>] [--wait-until <waitUntil>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--wait-until` | enum | No | `load` (default), `domcontentloaded`, `networkidle`, `commit` |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |
| `--target` | string | No | Stable target id returned by `start`; required when the profile has multiple active targets |

## Examples

```bash
# Reload a specific target
camo reload --target t_abc --profile my-profile
```

## Wiring

- CLI: `commands/builtins/reload.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the profile already started.
- A stale target or a target from another profile is rejected explicitly.
- Concurrent actions for the same profile return `E_STATE_LOCKED`.
- No fallback; first failure is reported.
- `wait-until` must be one of the allowed enum values.
