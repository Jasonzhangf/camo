# camo scroll

Scroll the active page by delta pixels, dispatching a real wheel event at the
given pointer position (default: viewport center).

## Usage

```
camo scroll --x <dx> --y <dy> [--at-x <px>] [--at-y <px>] [--profile <id>]
```

## Arguments

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--x` | integer | Yes* | Horizontal scroll delta (pixels) |
| `--y` | integer | Yes* | Vertical scroll delta (pixels) |
| `--at-x` | integer | No | Pointer x for the wheel event (default: viewport center) |
| `--at-y` | integer | No | Pointer y for the wheel event (default: viewport center) |
| `--profile` | string | No | Profile id (default: $CAMO_PROFILE or 'default') |

*At least one of `--x` or `--y` must be non-zero.

## Examples

```bash
# Scroll down 500px
camo scroll --y 500

# Scroll right 200px
camo scroll --x 200

# Scroll down over the left column (e.g. a phone mockup) on a wide screen
camo scroll --y 900 --at-x 200 --at-y 500
```

## Errors

- `E_INPUT_INVALID`: Neither --x nor --y is non-zero, values are not finite numbers, or --at-x/--at-y are negative
- `E_INPUT_MISSING_FIELD`: profile id is empty
