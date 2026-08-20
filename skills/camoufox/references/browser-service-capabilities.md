# Camo Capability Mapping (camo 0.4.2 only)

This reference maps runtime capabilities to commands that exist in the installed
`camo 0.4.2` CLI (`camo --help`). No direct HTTP/API calls are required when
using this skill, and none are allowed.

## 1. Service & Session Lifecycle

- daemon lifecycle: `camo daemon start|status|stop`
- session create/reuse: `camo start --profile <id> [--url ...]`
- session close: `camo stop --profile <id>`
- session/page state: `camo get-page-info --profile <id>`, `camo snapshot --profile <id>`

There is no `camo init`, `camo status`, `camo sessions`, `camo cleanup`,
`camo force-stop`, or `camo shutdown` in 0.4.2. Do not use them.

## 2. Browser/Page Primitives

- navigate: `camo goto <url> [--waitUntil ...]`, `camo fetch-page <url>`
- screenshot: `camo screenshot [--path <file>]`
- page content: `camo snapshot`, `camo get-text`, `camo get-readable`
- tabs: `camo new-tab`, `camo switch-tab`, `camo close-tab`, `camo list-tabs`
- viewport: `camo set-viewport --width <px> --height <px>`

There is no `camo back`, `camo new-page`, `camo switch-page`, `camo close-page`,
`camo list-pages`, or `camo viewport` in 0.4.2.

## 3. Element/Interaction Primitives

- protocol actions: `camo click`, `camo type`, `camo scroll`, `camo hover`,
  `camo select`, `camo upload`
- locate: `camo find-elements [--selector <css>|--text <text>]`
- wait: `camo wait [--for ...] [--target ...]`, `camo wait-dom-stable`

Selector arguments are CSS. Do not use v1 pseudo-selectors (`:visible`) or
comma-joined "engine" selector lists.

## 4. Cookies & Browser Settings

- read: `camo get-cookies`
- write: `camo set-cookies --cookies '<json-array>'`
- UA: `camo set-user-agent --ua <string>`
- viewport: `camo set-viewport --width <px> --height <px>`

Cookies persist in the profile data dir; there is no `camo cookies save/load` in 0.4.2.

## 5. Search

- `camo search <platform> <query> [--max-results <n>] [--cookies <file>]`

`search` is the only standalone (in-process) command; `--profile` still applies
when a browser session is involved.

## 6. Diagnostics (file-based, no `camo events` command)

- daemon/CLI events: `~/.camo/runs/run-<pid>-<ts>/events.jsonl`
- browser_service events: `~/.camo/runs/run-default/events.jsonl`
- daemon registration: `~/.camo/daemon/` (do not edit by hand)
- live process check: `camo daemon status`

`camo events serve/tail/recent/emit` do not exist in 0.4.2. Read the JSONL files
directly (`grep command.error <newest-run>/events.jsonl`).

Recommended failure triage order:
1. `camo get-page-info --profile <id>` (same profile, do not switch)
2. `camo snapshot --profile <id>`
3. `camo screenshot --profile <id> --path /tmp/camo-failure.png`
4. `camo find-elements --profile <id> --selector <css>`
5. `grep command.error` in the newest `~/.camo/runs/*/events.jsonl`

## 7. Safety Invariants

- One task = one profile. Repeat the same `--profile` on every command.
- Do not construct detail/search URLs manually when `camo search` covers the flow.
- No mouse/system fallback layer exists in 0.4.2; keep all actions at the protocol
  commands above.
- For risky actions, keep evidence snapshots + event logs before cleanup.
