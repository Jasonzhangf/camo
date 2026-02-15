# Camo CLI

[![CI](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@webauto%2Fcamo.svg)](https://www.npmjs.com/package/@webauto/camo)

A cross-platform command-line interface for Camoufox browser automation.

## Installation

### npm (Recommended)

```bash
npm install -g @webauto/camo
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

# Start browser
camo start --url https://example.com

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
camo start [profileId] [--url <url>] [--headless]
camo stop [profileId]
camo status [profileId]
camo shutdown                          # Shutdown browser-service (all sessions)
```

### Lifecycle & Cleanup

```bash
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

### Environment Variables

- `WEBAUTO_BROWSER_URL` - Browser service URL (default: `http://127.0.0.1:7704`)
- `WEBAUTO_REPO_ROOT` - WebAuto repository root (optional)

## Session Persistence

Camo CLI persists session information locally:

- Sessions are registered in `~/.webauto/sessions/`
- On restart, `camo sessions` shows both live and orphaned sessions
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
