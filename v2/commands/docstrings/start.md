# camo `start`

Boot or reuse a browser session and return its stable `target`.

Usage:
```
camo start [--profile <id>] [--url <https://...>] [--headless] [--ephemeral]
```

Notes:
- `default` is the normal persistent profile when `--profile` is omitted.
- Browser commands auto-start or reuse the shared daemon when needed; no
  separate `camo daemon start` step is required.
- `temp` and `--ephemeral` allocate a temporary profile that is reused until
  `stop` and then removed.
- Without `--url`, `start` does not navigate and does not reset the existing
  page to `about:blank`.
- With `--url`, only the target allocated to this start is navigated.
- The result contains `profile`, `sessionId`, and the stable `target` used by
  browser actions.
- Reusing a profile with one active target returns that target. A profile with
  multiple active targets requires an explicit `--target` on later actions.

Exit codes (matched to `contracts/error_envelope/codes.json`):
- E_INPUT_INVALID: invalid flag value (e.g. profile pattern).
- E_STATE_INVALID: the requested session mode conflicts with the existing session.
- E_STATE_LOCKED: the profile action pipeline is already busy.
