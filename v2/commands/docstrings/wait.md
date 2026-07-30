# camo wait

Wait for a condition to be satisfied.

## Usage

```
camo wait [--for <condition>] [--timeout <ms>] [--target <value>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--for` | enum | No | Condition: load, domcontentloaded, networkidle, selector, text, url (default: load) |
| `--timeout` | integer | No | Timeout in ms (default: 30000) |
| `--target` | string | No | Target value for selector/text/url conditions |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Wait for page load (default)
camo wait

# Wait for network idle
camo wait --for networkidle --timeout 60000

# Wait for selector to appear
camo wait --for selector --target ".loading" --timeout 10000
```

## Errors

- `E_INPUT_INVALID`: --for value not in allowed list, or timeout is invalid
- `E_INPUT_MISSING_FIELD`: profile id is empty
