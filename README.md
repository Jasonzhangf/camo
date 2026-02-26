# Camo CLI

[![CI](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@web-auto%2Fcamo.svg)](https://www.npmjs.com/package/@web-auto/camo)

A cross-platform command-line interface for Camoufox browser automation.

## What Camo Provides

- Browser lifecycle management: start/stop/list sessions, idle cleanup, lock cleanup.
- Profile-first automation: persistent profile dirs, fingerprint support, remembered window size.
- Browser control primitives: navigation, tabs, viewport/window, mouse and keyboard actions.
- Devtools debugging helpers: open devtools, evaluate JS quickly, collect browser console logs.
- Session recorder: JSONL interaction capture (click/input/scroll/keyboard + page visits) with runtime toggle.
- Container subscription layer: selector registration, filter/list/watch in viewport.
- Autoscript runtime: validate/explain/run/resume/mock-run with snapshot and replay.
- Progress stream: local websocket daemon (`/events`) with tail/recent/emit commands.

## Installation

### npm (Recommended)

```bash
npm install -g @web-auto/camo
```

### From Source

```bash
git clone https://github.com/Jasonzhangf/camo.git
cd camo
npm run build:global
```

## Quick Start

```bash
# Initialize environment
camo init

# Create a profile
camo profile create myprofile

# Set as default
camo profile default myprofile

# Start browser (with alias)
camo start --url https://example.com --alias main

# Start headless worker (auto-kill after idle timeout)
camo start worker-1 --headless --alias shard1 --idle-timeout 30m

# Start with devtools (headful only)
camo start worker-1 --devtools

# Evaluate JS (devtools-style input in page context)
camo devtools eval worker-1 "document.title"

# Read captured console entries
camo devtools logs worker-1 --levels error,warn --limit 50

# Start recording into JSONL (with in-page toggle)
camo record start worker-1 --name run-a --output ./logs/run-a.jsonl --overlay

# Navigate
camo goto https://www.xiaohongshu.com

# Interact
camo highlight-mode on
camo click "#search-input" --highlight
camo type "#search-input" "hello world" --highlight
camo scroll --down --amount 500 --selector ".feed-list"
```

## Codex Skill (`camoufox`)

This repository includes a Codex skill at `skills/camoufox`.

Install or refresh it locally:

```bash
mkdir -p ~/.codex/skills
rsync -a ./skills/camoufox/ ~/.codex/skills/camoufox/
```

Use it in Codex with `$camoufox` (or by asking for camo CLI workflows directly).

Layered capability model:
- Observe/Debug: visible DOM filtering, URL/context checks, devtools eval/logs.
- User Ops: click/type/scroll/keyboard/tab/window operations with optional highlight.
- Orchestration: container subscription + autoscript flows.
- Progress/Recovery: events/status/cleanup for runtime diagnostics.

## Core Workflows

### 1) Interactive browser session

```bash
camo init
camo profile create myprofile
camo profile default myprofile
camo start --url https://example.com --alias main
camo click "#search-input"
camo type "#search-input" "hello world"
```

### 2) Headless worker with idle auto-stop

```bash
camo start worker-1 --headless --alias shard1 --idle-timeout 30m
camo instances
camo stop idle
```

### 3) Devtools-style debugging

```bash
camo start myprofile --devtools
camo devtools eval myprofile "document.title"
camo devtools eval myprofile "(console.error('check-error'), location.href)"
camo devtools logs myprofile --levels error,warn --limit 50
camo devtools clear myprofile
```

### 4) Run autoscript with live progress

```bash
camo autoscript validate ./autoscripts/xhs.autoscript.json
camo autoscript run ./autoscripts/xhs.autoscript.json --profile myprofile \
  --jsonl-file ./runs/xhs/run.jsonl \
  --summary-file ./runs/xhs/summary.json
camo events tail --profile myprofile --mode autoscript
```

### 5) Record manual interactions as JSONL

```bash
camo start myprofile --record --record-name xhs-debug --record-output ./logs/xhs-debug.jsonl --record-overlay
camo record status myprofile
camo record stop myprofile
```

## Commands

### Profile Management

```bash
camo profiles                          # List profiles with default profile
camo profile create <profileId>        # Create a profile
camo profile delete <profileId>        # Delete a profile
camo profile default [profileId]       # Get or set default profile
```

### Initialization

```bash
camo init                              # Ensure camoufox + browser-service
camo init geoip                        # Download GeoIP database
camo init list                         # List available OS and regions
camo create fingerprint --os <os> --region <region>
```

### Config

```bash
camo config repo-root [path]           # Get/set persisted webauto repo root
camo highlight-mode [status|on|off]    # Global highlight mode for click/type/scroll
```

### Browser Control

```bash
camo start [profileId] [--url <url>] [--headless] [--devtools] [--record] [--record-name <name>] [--record-output <path>] [--record-overlay|--no-record-overlay] [--alias <name>] [--idle-timeout <duration>] [--width <w> --height <h>]
camo stop [profileId]
camo stop --id <instanceId>
camo stop --alias <alias>
camo stop idle
camo stop all
camo status [profileId]
camo shutdown                          # Shutdown browser-service (all sessions)
```

`camo start` in headful mode now persists window size per profile and reuses that size on next start.  
If no saved size exists, it defaults to near-fullscreen (full width, slight vertical reserve).  
Use `--width/--height` to override and update the saved profile size.
For headless sessions, default idle timeout is `30m` (auto-stop on inactivity). Use `--idle-timeout` (e.g. `45m`, `1800s`, `0`) to customize.
Use `--devtools` to open browser developer tools in headed mode (cannot be combined with `--headless`).
Use `--record` to auto-enable JSONL recording at startup; `--record-name`, `--record-output`, and `--record-overlay` customize file naming/output and floating toggle UI.

### Lifecycle & Cleanup

```bash
camo instances                         # List global camoufox instances (live + orphaned + idle state)
camo sessions                          # List active browser sessions
camo cleanup [profileId]               # Cleanup session (release lock + stop)
camo cleanup all                       # Cleanup all active sessions
camo cleanup locks                     # Cleanup stale lock files
camo force-stop [profileId]            # Force stop session (for stuck sessions)
camo lock list                         # List active session locks
```

### Navigation

```bash
camo goto [profileId] <url>            # Navigate to URL
camo back [profileId]                  # Navigate back
camo screenshot [profileId] [--output <file>] [--full]
```

### Interaction

```bash
camo scroll [profileId] [--down|--up|--left|--right] [--amount <px>] [--selector <css>] [--highlight|--no-highlight]
camo click [profileId] <selector> [--highlight|--no-highlight]  # Click visible element by CSS selector
camo type [profileId] <selector> <text> [--highlight|--no-highlight]  # Type into visible input element
camo highlight [profileId] <selector>          # Highlight element (red border, 2s)
camo clear-highlight [profileId]               # Clear all highlights
camo viewport [profileId] --width <w> --height <h>
```

### Devtools

```bash
camo devtools logs [profileId] [--limit 120] [--since <unix_ms>] [--levels error,warn] [--clear]
camo devtools eval [profileId] <expression> [--profile <id>]
camo devtools clear [profileId]
```

`devtools logs` reads entries from an injected in-page console collector.
Supported levels: `log`, `info`, `warn`, `error`, `debug`.

### Recording

```bash
camo record start [profileId] [--name <name>] [--output <file>] [--overlay|--no-overlay]
camo record stop [profileId] [--reason <text>]
camo record status [profileId]
```

Recorder JSONL events include:
- `page.visit`
- `interaction.click`
- `interaction.keydown`
- `interaction.input`
- `interaction.wheel`
- `interaction.scroll`
- `recording.start|stop|toggled|runtime_ready`

### Pages

```bash
camo new-page [profileId] [--url <url>]
camo close-page [profileId] [index]
camo switch-page [profileId] <index>
camo list-pages [profileId]
```

### Cookies

```bash
camo cookies get [profileId]                          Get all cookies for profile
camo cookies save [profileId] --path <file>           Save cookies to file
camo cookies load [profileId] --path <file>           Load cookies from file
camo cookies auto start [profileId] [--interval <ms>] Start auto-saving cookies
camo cookies auto stop [profileId]                    Stop auto-saving
camo cookies auto status [profileId]                  Check auto-save status
```

### Window Control

```bash
camo window move [profileId] --x <x> --y <y>
camo window resize [profileId] --width <w> --height <h>
```

### Mouse Control

```bash
camo mouse click [profileId] --x <x> --y <y> [--button left|right|middle] [--clicks <n>] [--delay <ms>]
camo mouse wheel [profileId] [--deltax <px>] [--deltay <px>]
```

### System

```bash
camo system display                    # Show display metrics
```

### Container Subscription

```bash
camo container init [--source <container-library-dir>] [--force]
camo container sets [--site <siteKey>]
camo container register [profileId] <setId...> [--append]
camo container targets [profileId]
camo container filter [profileId] <selector...>
camo container watch [profileId] [--selector <css>] [--throttle <ms>]
camo container list [profileId]
```

### Autoscript

```bash
camo autoscript validate <file>
camo autoscript explain <file>
camo autoscript snapshot <jsonl-file> [--out <snapshot-file>]
camo autoscript replay <jsonl-file> [--summary-file <path>]
camo autoscript run <file> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]
camo autoscript resume <file> --snapshot <snapshot-file> [--from-node <nodeId>] [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]
camo autoscript mock-run <file> --fixture <fixture.json> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]
```

### Progress Events (WS)

```bash
camo events serve [--host 127.0.0.1] [--port 7788]
camo events tail [--profile <id>] [--run-id <id>] [--events e1,e2] [--replay 50]
camo events recent [--limit 50]
```

By default, non-`events` commands auto-start the progress daemon (`/events`) in background.

## Fingerprint Options

### OS Options

- `mac` (default) - macOS (auto architecture)
- `mac-m1` - macOS with Apple Silicon
- `mac-intel` - macOS with Intel
- `windows` - Windows 11
- `windows-10` - Windows 10
- `linux` - Ubuntu 22.04

### Region Options

- `us` (default) - United States (New York)
- `us-west` - United States (Los Angeles)
- `uk` - United Kingdom (London)
- `de` - Germany (Berlin)
- `fr` - France (Paris)
- `jp` - Japan (Tokyo)
- `sg` - Singapore
- `au` - Australia (Sydney)
- `hk` - Hong Kong
- `tw` - Taiwan (Taipei)
- `br` - Brazil (Sao Paulo)
- `in` - India (Mumbai)

## Configuration

- Config file: `~/.webauto/camo-cli.json`
- Profiles directory: `~/.webauto/profiles/`
- Fingerprints directory: `~/.webauto/fingerprints/`
- Session registry: `~/.webauto/sessions/`
- Lock files: `~/.webauto/locks/`
- GeoIP database: `~/.webauto/geoip/GeoLite2-City.mmdb`
- User container root: `~/.webauto/container-lib/`
- Subscription root: `~/.webauto/container-subscriptions/`

### Subscription-driven Watch

```bash
# 1) Migrate container-library into subscription sets
camo container init --source /Users/fanzhang/Documents/github/webauto/container-library

# 2) Register sets to a profile
camo container register xiaohongshu-batch-1 xiaohongshu_home xiaohongshu_home.search_input

# 3) Start watch using registered selectors (no --selector needed)
camo container watch xiaohongshu-batch-1 --throttle 500
```

### Autoscript Mode (Subscription + Operations)

```bash
# Validate + explain + run
camo autoscript validate ./autoscripts/my-flow.autoscript.json
camo autoscript explain ./autoscripts/my-flow.autoscript.json
camo autoscript run ./autoscripts/my-flow.autoscript.json \
  --profile my-profile \
  --jsonl-file ./runs/my-flow/run.jsonl \
  --summary-file ./runs/my-flow/run.summary.json

# Build snapshot + replay summary from existing JSONL
camo autoscript snapshot ./runs/my-flow/run.jsonl \
  --out ./runs/my-flow/run.snapshot.json
camo autoscript replay ./runs/my-flow/run.jsonl \
  --summary-file ./runs/my-flow/replay.summary.json

# Resume from a snapshot (optionally force rerun from a node)
camo autoscript resume ./autoscripts/my-flow.autoscript.json \
  --snapshot ./runs/my-flow/run.snapshot.json \
  --from-node some_operation \
  --profile my-profile

# Mock replay mode for deterministic local debugging
camo autoscript mock-run ./autoscripts/my-flow.autoscript.json \
  --fixture ./autoscripts/fixtures/mock-run.json \
  --summary-file ./runs/my-flow/mock.summary.json
```

Example script:

```json
{
  "name": "generic-login-flow",
  "profileId": "my-profile",
  "throttle": 500,
  "subscriptions": [
    { "id": "login_input", "selector": "#login-input" },
    { "id": "submit_btn", "selector": "button.submit" }
  ],
  "operations": [
    {
      "id": "fill_login",
      "action": "type",
      "selector": "#login-input",
      "text": "demo@example.com",
      "trigger": "login_input.appear"
    },
    {
      "id": "click_submit",
      "action": "click",
      "selector": "button.submit",
      "trigger": { "subscription": "submit_btn", "event": "exist" },
      "conditions": [
        { "type": "operation_done", "operationId": "fill_login" },
        { "type": "subscription_exist", "subscriptionId": "submit_btn" }
      ]
    }
  ]
}
```

Condition types:
- `operation_done`: previous operation completed
- `subscription_exist`: subscribed element currently exists
- `subscription_appear`: subscribed element has appeared at least once

### Environment Variables

- `WEBAUTO_BROWSER_URL` - Browser service URL (default: `http://127.0.0.1:7704`)
- `WEBAUTO_INSTALL_DIR` - `@web-auto/webauto` 安装目录（可选，首次安装兜底）
- `WEBAUTO_REPO_ROOT` - WebAuto repository root (optional, dev mode)
- `WEBAUTO_DATA_ROOT` / `WEBAUTO_HOME` - 用户数据目录（Windows 默认 `D:/webauto`，无 D 盘回退 `~/.webauto`）
- `WEBAUTO_PROFILE_ROOT` - Profile 目录覆盖（默认 `<data-root>/profiles`）
- `WEBAUTO_ROOT` - 兼容旧变量（当值不是 `webauto/.webauto` 目录时会自动补 `.webauto`）
- `WEBAUTO_CONTAINER_ROOT` - User container root override (default: `~/.webauto/container-lib`)
- `CAMO_PROGRESS_EVENTS_FILE` - Optional progress event JSONL path override
- `CAMO_PROGRESS_WS_HOST` / `CAMO_PROGRESS_WS_PORT` - Progress websocket daemon bind address (default: `127.0.0.1:7788`)
- `CAMO_DEFAULT_WINDOW_VERTICAL_RESERVE` - Reserved vertical pixels for default headful auto-size

## Session Persistence

Camo CLI persists session information locally:

- Sessions are registered in `~/.webauto/sessions/`
- On restart, `camo sessions` / `camo instances` shows live + orphaned sessions
- Stale sessions (>7 days) are automatically cleaned up

## Requirements

- Node.js >= 20.0.0
- Python 3 with `camoufox` package

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Global install (build + test + install)
npm run build:global

# Bump version
npm run version:bump
```

## Release

```bash
# Create a release (bumps version, runs tests, creates tag)
./scripts/release.sh

# Or manually:
npm run version:bump
npm test
git add package.json
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag "v$(node -p "require('./package.json').version")"
git push --follow-tags
```

GitHub Actions will automatically:
1. Run tests on push to main
2. Publish to npm when a release is created

## License

MIT
