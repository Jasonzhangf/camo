# camo switch-tab

Bring a target's page to the foreground.

## Usage

```
camo switch-tab --target <t_id> [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--target` | string | Yes | Stable target id returned by `start`, `new-tab`, or `multi-open` |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# List tabs to find a target
camo list-tabs --profile my-profile

# Bring that target's page to the foreground
camo switch-tab --target t_abc123 --profile my-profile
```

## Wiring

- CLI: `commands/builtins/switchTab.mjs`
- Pipeline: `services/page_runtime/input_pipeline.mjs` → `page_ops.mjs`
- Registry: `commands/registry/registry.json`

## Hard Guards

- Requires an active browser session with the target already allocated.
- The result returns stable `target` and `page` ids; array indices are never caller identity.
- A stale or cross-profile target fails explicitly.
- No fallback; first failure is reported.
- Protocol-level: brings the target tab to front (no JS DOM hack).
