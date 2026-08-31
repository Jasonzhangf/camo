# `camo back`

Navigate the active page back one history entry.

## Usage

```
camo back [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Go back after a click navigated away
camo back --profile my-profile
```

## Wiring

- CLI: `commands/builtins/back.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the profile already started.
- No fallback; first failure is reported.
- `navigated` is `false` when there is no previous history entry.
