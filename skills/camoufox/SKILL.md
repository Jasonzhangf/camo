---
name: camoufox
description: Use camo v2 CLI for Camoufox browser automation. 28 commands, daemon-based architecture, ephemeral/persistent session modes, OpenMinis-aligned action set.
---

# Camoufox (`camo`) Skill — v2

`camo` only. No v1 commands exist. Keep this skill short and operational.

## Architecture (v2)

- **Daemon process**: `camo daemon start|stop|status` manages a long-lived daemon
- **Browser engine**: Camoufox only. The CLI does not expose a Playwright browser launcher.
- **Ephemeral mode**: default, no profile needed, auto-cleanup after command
- **Persistent mode**: `--profile <name>`, browser stays until `camo daemon stop`
- **28 commands**: click, daemon, evaluate, goto, screenshot, scroll, select, snapshot, start, stop, type, upload, wait, hover, get-text, get-page-info, find-elements, get-readable, new-tab, close-tab, list-tabs, get-cookies, set-cookies, set-user-agent, set-viewport, wait-dom-stable, scroll-and-collect, fetch-page
- **Port 0 dynamic**: daemon auto-assigns free ports, registers at `~/.camo/daemon/<id>.json`
- **Profile lock**: prevents concurrent daemons on same profile
- **No fallback, no fake transport, no silent retry**

## Hard Constraint

Allowed execution surface:
- `camo --help` or `camo <cmd> --help` to explore
- `camo daemon start --profile <name>` — start daemon first
- `camo <cmd> [--profile <name>] [args]` — send command via WS
- `camo daemon stop --profile <name>` — stop daemon
- Do not run `playwright`, `npx playwright install`, direct browser scripts, or direct browser-service imports.

Disallowed:
- Starting browser without a daemon
- Using v1 commands that no longer exist (`container`, `autoscript`, `events`, `devtools`, `profile create`, `init`, etc.)

If a required action is unclear or missing, run:
```bash
camo --help
camo <cmd> --help
```
Then report capability gap instead of switching control surface.

## Standard Execution Order

1. Start daemon: `camo daemon start --profile <name>`
2. Start browser session: `camo start --profile <name> --headless`
3. Execute: `camo goto --profile <name> <url>`, `camo click ...`, `camo snapshot ...`
4. Collect evidence: `camo screenshot --profile <name>`
5. Stop session: `camo stop --profile <name>`
6. Stop daemon: `camo daemon stop --profile <name>`

## 28 Commands (OpenMinis-aligned)

| Command | Args | Description |
|---------|------|-------------|
| daemon | start\|stop\|status [--profile] | Daemon lifecycle |
| start | [--profile] [--url] [--headless] | Start browser session |
| stop | [--profile] | Stop browser session |
| goto | <url> [--waitUntil] | Navigate to URL |
| click | [--selector\|--text] [--button] | Click element |
| type | <text> [--selector] [--delay] | Type text |
| scroll | [--x] [--y] | Scroll page |
| screenshot | [--path] [--full-page] | Take screenshot |
| snapshot | [--format json\|yaml] | DOM snapshot |
| wait | [--ms] | Wait ms |
| evaluate | --script <js> | Run JS in page |
| upload | --selector <css> --file <path> | Upload file |
| select | --selector <css> --value <v> | Select option |
| hover | --selector\|--text | Hover over element |
| get-text | [--selector] | Get page/element text |
| get-page-info | | Get page title, URL, dimensions |
| find-elements | --selector\|--text | Find DOM elements |
| get-readable | [--max-length] | Extract readable article content |
| new-tab | [--url] | Create new browser tab |
| close-tab | --tab-id <n> | Close tab by index |
| list-tabs | | List all open tabs |
| get-cookies | | Get browser cookies |
| set-cookies | --cookies <json> | Set browser cookies |
| set-user-agent | --ua <string> | Set user agent |
| set-viewport | --width --height | Set viewport size |
| wait-dom-stable | [--timeout] [--poll] | Wait for DOM stability |
| scroll-and-collect | [--scroll-count] [--delay] | Scroll and collect text |
| fetch-page | <url> [--timeout] | Fetch page content via browser |

## Environment Variables

- `CAMO_WS_PORT` / `CAMO_HTTP_PORT` — daemon ports (default 0 = auto)
- `CAMO_PROFILE` — default profile id
- `CAMO_HEADLESS=1` — headless mode

## References

- `v2/PLAN.md` — architecture plan
- `v2/README.md` — v2 readme
- `v2/GOAL.md` — rebuild goal
