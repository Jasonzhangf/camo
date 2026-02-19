# Camo CLI

[![CI](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@web-auto%2Fcamo.svg)](https://www.npmjs.com/package/@web-auto/camo)

A cross-platform command-line interface for Camoufox browser automation.

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

# Navigate
camo goto https://www.xiaohongshu.com

# Interact
camo click "#search-input"
camo type "#search-input" "hello world"
camo scroll --down --amount 500
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

### Browser Control

```bash
camo start [profileId] [--url <url>] [--headless] [--devtools] [--alias <name>] [--idle-timeout <duration>] [--width <w> --height <h>]
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

### Lifecycle & Cleanup

```bash
camo instances                         # List global camoufox instances (live + orphaned + idle state)
camo sessions                          # List active browser sessions
camo cleanup [profileId]               # Cleanup session (release lock + stop)
camo cleanup all                       # Cleanup all active sessions
camo cleanup locks                     # Cleanup stale lock files
camo force-stop [profileId]            # Force stop session (for stuck sessions)
camo lock list                         # List active session locks
camo recover [profileId]               # Recover orphaned session
```

### Navigation

```bash
camo goto [profileId] <url>            # Navigate to URL
camo back [profileId]                  # Navigate back
camo screenshot [profileId] [--output <file>] [--full]
```

### Interaction

```bash
camo scroll [profileId] [--down|--up|--left|--right] [--amount <px>]
camo click [profileId] <selector>              # Click element by CSS selector
camo type [profileId] <selector> <text>        # Type text into element
camo highlight [profileId] <selector>          # Highlight element (red border, 2s)
camo clear-highlight [profileId]               # Clear all highlights
camo viewport [profileId] --width <w> --height <h>
```

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
camo mouse move [profileId] --x <x> --y <y> [--steps <n>]
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
camo autoscript scaffold xhs-unified [--output <file>] [options]
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
# Generate xiaohongshu unified-harvest migration script from webauto phase-unified-harvest
camo autoscript scaffold xhs-unified \
  --output ./autoscripts/xiaohongshu/unified-harvest.autoscript.json \
  --profile xiaohongshu-batch-1 \
  --keyword "手机膜" \
  --tab-count 4 \
  --note-interval 900 \
  --do-comments \
  --do-likes \
  --max-notes 30

# Validate + explain + run
camo autoscript validate ./autoscripts/xiaohongshu/unified-harvest.autoscript.json
camo autoscript explain ./autoscripts/xiaohongshu/unified-harvest.autoscript.json
camo autoscript run ./autoscripts/xiaohongshu/unified-harvest.autoscript.json \
  --profile xiaohongshu-batch-1 \
  --jsonl-file ./runs/xhs-unified/run.jsonl \
  --summary-file ./runs/xhs-unified/run.summary.json

# Build snapshot + replay summary from existing JSONL
camo autoscript snapshot ./runs/xhs-unified/run.jsonl \
  --out ./runs/xhs-unified/run.snapshot.json
camo autoscript replay ./runs/xhs-unified/run.jsonl \
  --summary-file ./runs/xhs-unified/replay.summary.json

# Resume from a snapshot (optionally force rerun from a node)
camo autoscript resume ./autoscripts/xiaohongshu/unified-harvest.autoscript.json \
  --snapshot ./runs/xhs-unified/run.snapshot.json \
  --from-node comments_harvest \
  --profile xiaohongshu-batch-1

# Mock replay mode for deterministic local debugging
camo autoscript mock-run ./autoscripts/xiaohongshu/unified-harvest.autoscript.json \
  --fixture ./autoscripts/xiaohongshu/fixtures/mock-run.json \
  --summary-file ./runs/xhs-unified/mock.summary.json
```

The xhs-unified scaffold includes anti-risk defaults:
- operation pacing (`operationMinIntervalMs`, `eventCooldownMs`, `jitterMs`)
- navigation/tab switch cooldown (`navigationMinIntervalMs`)
- per-operation timeout budget (`timeoutMs`)
- multi-tab rotation (`ensure_tab_pool`, `tab_pool_switch_next`)

Example script:

```json
{
  "name": "xhs-login-flow",
  "profileId": "xiaohongshu-batch-1",
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
- `WEBAUTO_REPO_ROOT` - WebAuto repository root (optional)
- `WEBAUTO_CONTAINER_ROOT` - User container root override (default: `~/.webauto/container-lib`)
- `CAMO_PROGRESS_EVENTS_FILE` - Optional progress event JSONL path override
- `CAMO_PROGRESS_WS_HOST` / `CAMO_PROGRESS_WS_PORT` - Progress websocket daemon bind address (default: `127.0.0.1:7788`)

## Session Persistence

Camo CLI persists session information locally:

- Sessions are registered in `~/.webauto/sessions/`
- On restart, `camo sessions` / `camo instances` shows live + orphaned sessions
- Use `camo recover <profileId>` to reconnect or cleanup orphaned sessions
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
