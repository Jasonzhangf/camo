# camo upload

Upload a file to an `<input type="file">` element.

## Usage

```
camo upload --selector <css> --file <path> [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--selector` | string | Yes | CSS selector for the file input element |
| `--file` | string | Yes | Path to the file to upload |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

## Examples

```bash
# Upload a file
camo upload --selector "input[type=file]" --file ./document.pdf

# Specific profile
camo upload --profile my-profile --selector "#file-upload" --file ./image.png
```

## Errors

- `E_INPUT_MISSING_FIELD`: --selector or --file is empty
- `E_INPUT_MISSING_FIELD`: profile id is empty
