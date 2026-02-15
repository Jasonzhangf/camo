# Camo CLI

A cross-platform command-line interface for Camoufox browser automation.

## Installation

### macOS / Linux

```bash
npm install -g camo
```

### Windows

```powershell
npm install -g camo
```

## Usage

```bash
camo <command> [options]
```

### Profile Management

```bash
camo profiles                          # List profiles
camo profile create myprofile          # Create a profile
camo profile default myprofile         # Set default profile
camo profile delete myprofile          # Delete a profile
```

### Browser Control

```bash
camo init                              # Ensure camoufox + browser-service
camo start --url https://example.com   # Start browser with URL
camo stop                              # Stop browser
camo status                            # Show browser status
```

### Navigation

```bash
camo goto https://example.com          # Navigate to URL
camo back                              # Go back
camo screenshot --output shot.png      # Take screenshot
```

### Interaction

```bash
camo scroll --down --amount 500        # Scroll down
camo click "#search-input"             # Click element
camo type "#search-input" "hello"      # Type text
camo highlight ".post-card"            # Highlight element
camo viewport --width 1920 --height 1080
```

### Pages

```bash
camo new-page --url https://example.com
camo list-pages
camo switch-page 0
camo close-page 0
```

## Configuration

- Config file: `~/.webauto/camo-cli.json`
- Profiles directory: `~/.webauto/profiles/`

### Environment Variables

- `WEBAUTO_BROWSER_URL` - Browser service URL (default: `http://127.0.0.1:7704`)
- `WEBAUTO_REPO_ROOT` - WebAuto repository root (optional)

## Requirements

- Node.js >= 20.0.0
- Python 3 with `camoufox` package

## License

MIT
