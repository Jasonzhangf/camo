# `camo back`

Navigate a target's page back one history entry.

## Usage

```
camo back [--target <t_id>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |
| `--target` | string | No | Stable target id returned by `start`; required when the profile has multiple active targets |

## Examples

```bash
# Go back after a click navigated away
camo back --target t_abc --profile my-profile
```

## Wiring

- CLI: `commands/builtins/back.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the profile already started.
- A stale target or a target from another profile is rejected explicitly.
- Concurrent actions for the same profile return `E_STATE_LOCKED`.
- No fallback; first failure is reported.
- `navigated` is `false` when there is no previous history entry.
