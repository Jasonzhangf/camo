# camo `click`

Click an element on the active page. Provide EITHER `--selector` OR `--text`.

Usage:
```
camo click --selector <css> [--profile <id>] [--button left|middle|right]
camo click --text "<literal>"     [--profile <id>] [--button ...]
```

Notes:
- Exactly one of `selector` or `text` must be present.
- Click is performed by `services/page_runtime/input_pipeline`.

Exit codes:
- E_INPUT_INVALID: both or neither of selector/text supplied.
- E_STATE_NOT_FOUND: no element matched.
