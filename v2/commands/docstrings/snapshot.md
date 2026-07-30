# camo snapshot

Return the current session/page state as a structured snapshot.

## Usage

```
camo snapshot [--format json|yaml] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--format` | enum | No | Output format: json or yaml (default: json) |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Get snapshot as JSON
camo snapshot

# Get snapshot as YAML
camo snapshot --format yaml

# Specific profile
camo snapshot --profile my-profile --format json
```

## Errors

- `E_INPUT_INVALID`: --format value is not json or yaml
- `E_INPUT_MISSING_FIELD`: profile id is empty
