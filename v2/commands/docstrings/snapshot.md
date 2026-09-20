# camo snapshot

Return a target's page state as a structured snapshot.

## Usage

```
camo snapshot [--format json|yaml] [--target <t_id>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--format` | enum | No | Output format: json or yaml (default: json) |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |
| `--target` | string | No | Stable target id returned by `start`; required when the profile has multiple active targets |

## Examples

```bash
# Get snapshot as JSON
camo snapshot

# Get snapshot as YAML
camo snapshot --format yaml

# Specific profile
camo snapshot --profile my-profile --format json

# Specific target
camo snapshot --target t_abc --format json
```

## Errors

- `E_INPUT_INVALID`: --format value is not json or yaml
- `E_INPUT_MISSING_FIELD`: profile id is empty
- `E_STATE_INVALID`: the target is stale or belongs to another profile
- `E_STATE_LOCKED`: another action for the same profile is in flight
