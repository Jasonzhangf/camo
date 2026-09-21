# camo `keyboard`

Press a real keyboard key in the active page.

Usage:
```
camo keyboard press <key> [--target <t_id>] [--profile <id>] [--timeout <ms>]
```

Supported keys:
`Enter`, `Escape`, `Tab`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`.

The key is dispatched through the browser protocol. No JavaScript event
synthesis or DOM shortcut is used.
