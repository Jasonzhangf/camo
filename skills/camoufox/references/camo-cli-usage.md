# camo CLI Usage (camo 0.4.2)

## 0. Enforcement

Use `camo` commands only. No `curl` API calls, no `node scripts/...`
browser-control scripts, no ad-hoc wrappers that bypass `camo`.

If a command is uncertain, check the installed CLI:

```bash
camo --help
camo <command> --help
```

Any command not listed by `camo --help` does not exist in this installed build.
Do not use v1 leftovers (`init`, `profile create`, `sessions`, `status`,
`cleanup`, `force-stop`, `shutdown`, `back`, `new-page`, `container`,
`autoscript`, `events`, `highlight`, `mouse`, `window`, `cookies save/load`, ...).

## 1. Quick Start

```bash
# 1) Start the shared daemon (persistent default profile)
camo daemon start --profile default

# 2) Start a browser session
camo start --profile default --url https://example.com

# 3) Inspect the page
camo get-page-info --profile default
camo snapshot --profile default

# 4) Stop the session, then the daemon
camo stop --profile default
camo daemon stop
```

## 2. Command Map

All `--profile` flags are `--profile <id>`; there are no positional profile
arguments in 0.4.2.

### Daemon and session lifecycle

```bash
camo daemon start [--profile <id>] [--ephemeral]
camo daemon status [--profile <id>]
camo daemon stop  [--profile <id>]
camo start [--profile <id>] [--url <url>] [--headless]
camo stop  [--profile <id>]
```

Profile resolution: explicit `--profile` > `CAMO_PROFILE` > `default`.
Ephemeral requires an explicit `--ephemeral` on the daemon command;
`camo start` without `--profile` uses persistent `default`.

### Navigation / page state

```bash
camo goto <url> [--profile <id>] [--waitUntil load|domcontentloaded|networkidle]
camo fetch-page <url> [--profile <id>] [--timeout <ms>]
camo get-page-info [--profile <id>]
camo get-text [--selector <css>] [--profile <id>]
camo get-readable [--maxLength <n>] [--profile <id>]
camo find-elements [--selector <css>|--text <text>] [--profile <id>]
camo snapshot [--format json|yaml] [--profile <id>]
camo screenshot [--profile <id>] [--path <file>]
```

### Interaction

```bash
camo click (--selector <css>|--text <text>) [--button left|middle|right] [--profile <id>]
camo hover (--selector <css>|--text <text>) [--profile <id>]
camo type <text> [--selector <css>] [--delay <ms>] [--profile <id>]
camo scroll [--x <px>] [--y <px>] [--profile <id>]
camo select --selector <css> --value <value> [--profile <id>]
camo upload --selector <css> --file <path> [--profile <id>]
camo wait [--for load|domcontentloaded|networkidle|selector|text|url] \
  [--target <value>] [--timeout <ms>] [--ms <ms>] [--profile <id>]
camo wait-dom-stable [--timeout <ms>] [--poll <ms>] [--profile <id>]
camo scroll-and-collect [--scrollCount <n>] [--delay <ms>] [--profile <id>]
```

### Tabs / cookies / browser settings

```bash
camo new-tab [--url <url>] [--profile <id>]
camo list-tabs [--profile <id>]
camo switch-tab --tabId <index> [--profile <id>]
camo close-tab --tabId <index> [--profile <id>]
camo get-cookies [--profile <id>]
camo set-cookies --cookies '<json-array>' [--profile <id>]
camo set-user-agent --ua <string> [--profile <id>]
camo set-viewport --width <px> --height <px> [--profile <id>]
```

### Search

```bash
camo search <platform> <query> [--profile <id>] [--max-results <n>] [--cookies <file>]
```

## 3. Practical Flows

### A) Headless page verification

```bash
camo daemon start --profile default
camo start --profile default --headless --url https://example.com
camo get-page-info --profile default
camo screenshot --profile default --path /tmp/example.png
camo stop --profile default
camo daemon stop
```

### B) Search bootstrap (in-process search command)

```bash
camo daemon start --profile default
camo search xhs "咖啡探店" --profile default --max-results 20
camo stop --profile default
camo daemon stop
```

### C) Isolated multi-command check (ephemeral daemon)

```bash
camo daemon start --profile skill-check --ephemeral
camo start --profile skill-check --url https://example.com
camo get-page-info --profile skill-check
camo stop --profile skill-check
camo daemon stop
```

### D) Failure evidence

```bash
camo get-page-info --profile <id>
camo snapshot --profile <id>
camo screenshot --profile <id> --path /tmp/camo-failure.png
grep command.error "$(ls -dt ~/.camo/runs/run-*/events.jsonl | head -1)"
```

Cleanup is sequential: wait for `camo stop` to return, then run
`camo daemon stop`. Do not run them concurrently.

## 4. Troubleshooting

- No active daemon: run `camo daemon start --profile <id>` first, or set
  `CAMO_AUTOSTART=1` when calling `camo start`.
- `E_STATE_DUPLICATE`: the profile already has a session. Inspect it on the same
  profile; only then decide to `camo stop` and start fresh. Never start a second
  session for the same profile.
- Invalid selector: use CSS syntax; do not pass v1 pseudo-selectors like `:visible`.
- `goto` timeout: retry with `--waitUntil domcontentloaded` on the same profile;
  do not switch profiles or fall back to `evaluate`.
- Daemon lifecycle: use `camo daemon status` / `camo daemon stop`, never edit
  `~/.camo/daemon/*.json` by hand.
- `E_DAEMON_STOP_FAILED ... pid still alive after SIGTERM + 5s`: browser teardown
  can exceed 5s. Check `camo daemon status`; `not_running` means shutdown succeeded,
  otherwise re-run `camo daemon stop` once.
