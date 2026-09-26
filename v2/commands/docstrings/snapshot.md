# camo snapshot

Return a target's page state as a structured snapshot. Default output is
machine-readable semantic JSON (`format: semantic-json`) with `snapshotId`,
`documentId`, `url`, `title`, `viewport`, `window`, and `tree.nodes`. Raw HTML
is only returned when `--raw-dom` is explicitly set.

## Usage

```
camo snapshot [--format json|yaml] [--raw-dom] [--target <t_id>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--format` | enum | No | Output format: json or yaml (default: json) |
| `--raw-dom` | boolean | No | Return `html`/`htmlLength` instead of semantic JSON; raw HTML is never the default |
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

# Explicitly request raw HTML only when needed
camo snapshot --raw-dom
```

## Errors

- `E_INPUT_INVALID`: --format value is not json or yaml
- `E_INPUT_MISSING_FIELD`: profile id is empty
- `E_STATE_INVALID`: the target is stale or belongs to another profile
- `E_STATE_LOCKED`: another action for the same profile is in flight
- `E_SNAPSHOT_CAPABILITY_MISSING`: the page binding cannot provide semantic accessibility data; no HTML/screenshot fallback is performed
