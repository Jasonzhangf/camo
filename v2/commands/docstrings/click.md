# camo `click`

Click an element on the active page. Provide EITHER `--selector` OR `--text`.

Usage:
```
camo click --selector <css> [--profile <id>] [--button left|middle|right] [--dialog-action accept|dismiss] [--dialog-text <text>] [--timeout <ms>]
camo click --text "<literal>"     [--profile <id>] [--button ...] [--dialog-action accept|dismiss] [--dialog-text <text>] [--timeout <ms>]
```

Notes:
- Exactly one of `selector` or `text` must be present.
- Click is performed by `services/page_runtime/input_pipeline`.
- `--dialog-action` explicitly handles one native browser dialog triggered by this click. Use `accept` with `--dialog-text` for `window.prompt()`; use `dismiss` to cancel. No dialog handling is installed unless requested.
- The hard operation timeout defaults to 30000 ms.

Exit codes:
- E_INPUT_INVALID: both or neither of selector/text supplied.
- E_STATE_NOT_FOUND: no element matched.
