# camo select

Select an option in a `<select>` element by value.

## Usage

```
camo select --selector <css> --value <val> [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--selector` | string | Yes | CSS selector for the `<select>` element |
| `--value` | string | Yes | Value of the option to select |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Select by value
camo select --selector "select[name=country]" --value "CN"

# Select in specific profile
camo select --profile my-profile --selector "#country" --value "US"
```

## Errors

- `E_INPUT_MISSING_FIELD`: --selector or --value is empty
- `E_INPUT_MISSING_FIELD`: profile id is empty
- `E_INPUT_INVALID`: --value is not a string
