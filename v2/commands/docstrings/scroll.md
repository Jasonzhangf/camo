# camo scroll

Scroll the active page by delta pixels.

## Usage

```
camo scroll --x <dx> --y <dy> [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--x` | integer | Yes* | Horizontal scroll delta (pixels) |
| `--y` | integer | Yes* | Vertical scroll delta (pixels) |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

*At least one of `--x` or `--y` must be non-zero.

## Examples

```bash
# Scroll down 500px
camo scroll --y 500

# Scroll right 200px
camo scroll --x 200

# Scroll diagonally
camo scroll --x 100 --y 300
```

## Errors

- `E_INPUT_INVALID`: Neither --x nor --y is non-zero, or values are not finite numbers
- `E_INPUT_MISSING_FIELD`: profile id is empty
