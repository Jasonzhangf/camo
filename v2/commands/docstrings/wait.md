# camo wait

Wait for a condition to be satisfied.

## Usage

```
camo wait [--for <condition>] [--condition <value>] [--timeout <ms>] [--ms <ms>] [--target <t_id>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--for` | enum | No | Condition: load, domcontentloaded, networkidle, selector, text, url (default: load) |
| `--timeout` | integer | No | Timeout in ms (default: 30000) |
| `--ms` | integer | No | Duration in ms |
| `--condition` | string | No | Selector, text, or URL value for selector/text/url conditions |
| `--target` | string | No | Stable target id returned by `start`; required when the profile has multiple active targets |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Wait for page load (default)
camo wait

# Wait for network idle
camo wait --for networkidle --timeout 60000

# Wait for selector to appear
camo wait --for selector --condition ".loading" --timeout 10000
```

## Errors

- `E_INPUT_INVALID`: --for value not in allowed list, or timeout is invalid
- `E_INPUT_MISSING_FIELD`: profile id is empty
- `E_STATE_INVALID`: multiple active targets exist and `--target` is omitted
