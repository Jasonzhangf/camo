# `camo forward`

Navigate the active page forward one history entry.

## Usage

```
camo forward [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Redo a back navigation
camo forward --profile my-profile
```

## Wiring

- CLI: `commands/builtins/forward.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the profile already started.
- No fallback; first failure is reported.
- `navigated` is `false` when there is no next history entry.
