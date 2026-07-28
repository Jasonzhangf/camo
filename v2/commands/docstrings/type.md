# camo `type`

Type text into the active page. Optionally target an input by selector.

Usage:
```
camo type <text> [--profile <id>] [--selector <css>] [--delay <ms>]
```

Notes:
- The text is the single required positional argument.
- `--delay` is per-keystroke, in milliseconds, range [0..5000].
- When `--selector` is omitted, types into the focused element.

Exit codes:
- E_INPUT_INVALID: empty text or invalid delay.
- E_STATE_NOT_FOUND: no element matched when --selector used.
