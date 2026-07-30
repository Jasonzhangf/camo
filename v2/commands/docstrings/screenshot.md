# camo screenshot

Take a screenshot of the active page.

## Usage

```
camo screenshot [--path <file>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--path` | string | No | Output file path (default: temp dir with .png) |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Screenshot to temp file
camo screenshot

# Screenshot to specific path
camo screenshot --path ./screenshot.png

# Specific profile
camo screenshot --profile my-profile --path ./my-screenshot.png
```

## Errors

- `E_INPUT_INVALID`: path is not a valid string
- `E_INPUT_MISSING_FIELD`: profile id is empty
