# `camo switch-tab`

Switch the active browser tab to the given tab index (from `camo list-tabs`).

## Usage

```
camo switch-tab --tab-id <n> [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--tab-id` | integer | Yes | Zero-based tab index from `camo list-tabs` |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# List tabs to find the index
camo list-tabs --profile my-profile

# Switch to tab 1
camo switch-tab --tab-id 1 --profile my-profile
```

## Wiring

- CLI: `commands/builtins/switchTab.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the profile already started.
- `tab-id` must be a valid index into `list-tabs`; out of range is an error.
- No fallback; first failure is reported.
- Protocol-level: brings the target tab to front (no JS DOM hack).
