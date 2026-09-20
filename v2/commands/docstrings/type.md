# camo `type`

Type text into a target's page. Optionally target an input by selector.

Usage:
```
camo type <text> [--target <t_id>] [--profile <id>] [--selector <css>] [--delay <ms>]
```

Notes:
- The text is the single required positional argument.
- `--target` is the stable handle returned by `start`; when omitted, a profile
  with exactly one active target is selected and multiple targets are ambiguous.
- `--delay` is per-keystroke, in milliseconds, range [0..5000].
- When `--selector` is omitted, types into the focused element.

Exit codes:
- E_INPUT_INVALID: empty text or invalid delay.
- E_STATE_NOT_FOUND: no element matched when --selector used.
- E_STATE_INVALID: the target is stale or belongs to another profile.
- E_STATE_LOCKED: another action for the same profile is in flight.
