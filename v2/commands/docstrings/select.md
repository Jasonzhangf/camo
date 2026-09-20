# camo select

Select an option in a `<select>` element by value.

## Usage

```
camo select --selector <css> --value <val> [--target <t_id>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--selector` | string | Yes | CSS selector for the `<select>` element |
| `--value` | string | Yes | Value of the option to select |
| `--target` | string | No | Stable target id returned by `start`; required when the profile has multiple active targets |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Select by value
camo select --selector "select[name=country]" --value "CN"

# Select in specific profile
camo select --profile my-profile --selector "#country" --value "US"

# Select in a specific target
camo select --target t_abc123 --selector "#country" --value "US"
```

## Errors

- `E_INPUT_MISSING_FIELD`: --selector or --value is empty
- `E_INPUT_MISSING_FIELD`: profile id is empty
- `E_INPUT_INVALID`: --value is not a string
- `E_STATE_INVALID`: target is stale, belongs to another profile, or is ambiguous
