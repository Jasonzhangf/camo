# camo evaluate

Execute arbitrary JavaScript in the page context.

## Usage

```
camo evaluate --script <js> [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--script` | string | Yes | JavaScript code to execute in page context |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Get page title
camo evaluate --script "document.title"

# Get element count
camo evaluate --script "document.querySelectorAll('.item').length"
```

## Errors

- `E_INPUT_MISSING_FIELD`: --script is empty or missing
- `E_INPUT_MISSING_FIELD`: profile id is empty

## Notes

- The script runs in the browser's page context
- Return values are serialized as JSON
- Avoid long-running scripts as they may timeout
