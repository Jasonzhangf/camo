# Camo CLI

[![CI](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml/badge.svg)](https://github.com/Jasonzhangf/camo/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@web-auto%2Fcamo.svg)](https://www.npmjs.com/package/@web-auto/camo)

Camo is a Camoufox browser automation CLI and shared runtime. Browser actions
are addressed by stable target ids returned by `camo start`, `camo new-tab`, or
`camo multi-open`.

## Install

```bash
npm install -g @web-auto/camo
```

From a source checkout:

```bash
npm run build:global
```

## Quick start

```bash
camo start --url https://example.com
# copy the returned target id
camo get-page-info --target t_abc123
camo click --target t_abc123 --selector "h1"
camo status --target t_abc123
camo stop
```

An ordinary browser command auto-starts or reuses the shared daemon when
needed. A separate `camo daemon start` is not required. `camo start` without
`--url` creates or reuses the session and target without navigating the page.

`status` is different from other commands: it never starts a daemon or browser.
With no active daemon it returns `service.state: unavailable`; with a daemon it
reads the current session, target, execution, and reclamation projections
without refreshing idle time or changing runtime state.

## Target model

`target` is the external operation handle. It binds a profile, session
generation, and stable page identity. The daemon resolves the target; page
runtime receives only the internal page handle.

- `profile` is the persistent data and account boundary.
- `session` is one browser runtime generation.
- `target` is the caller-visible handle for a page.
- `pageId`, `sessionId`, and `generation` are internal control fields.

If a profile has multiple active targets, browser actions must pass
`--target`. Camo does not guess the current, foreground, newest, or indexed
page. A target from a stopped session or another profile fails explicitly.

## Commands

### Lifecycle

```bash
camo start [--profile <id>] [--url <https://...>] [--headless] [--ephemeral]
camo stop [--profile <id>]
camo status [--profile <id>] [--target <t_id>]
camo daemon status
camo daemon stop
```

- `start` returns `{ profile, sessionId, target }`.
- `stop` closes the browser session and invalidates its targets.
- `temp` or `--ephemeral` allocates a temporary profile that is reused until
  `stop`; `stop` closes the browser first and then deletes the temporary data.
- If temporary data deletion fails, `stop` returns
  `E_BROWSER_CLEANUP_FAILED`; the pending cleanup remains visible in `status`.
- `daemon status` is the low-level process/registration probe. Use `camo
  status` for the runtime projection.

### Browser actions

All actions below accept `[--target <t_id>]` and `[--profile <id>]` where
applicable:

```bash
camo goto <url> [--waitUntil load|domcontentloaded|networkidle]
camo back
camo forward
camo reload [--waitUntil load|domcontentloaded|networkidle|commit]
camo click (--selector <css>|--text <text>)
camo type <text> [--selector <css>] [--delay <ms>]
camo scroll [--x <px>] [--y <px>] [--at-x <px>] [--at-y <px>]
camo hover (--selector <css>|--text <text>)
camo snapshot [--format json|yaml]
camo screenshot [--path <file>]
camo evaluate --script <js>
camo wait [--for load|domcontentloaded|networkidle|selector|text|url] [--condition <value>] [--timeout <ms>] [--ms <ms>]
camo find-elements (--selector <css>|--text <text>)
camo get-text [--selector <css>]
camo get-readable [--maxLength <n>]
camo get-page-info
camo fetch-page <url> [--timeout <ms>]
```

### Tabs and settings

```bash
camo new-tab [--url <https://...>] [--target <t_id>]
camo list-tabs [--target <t_id>]
camo switch-tab --target <t_id>
camo close-tab --target <t_id>
camo multi-open --urls <u1,u2,...> [--target <t_id>] [--out-dir <dir>] [--prefix <name>]
camo get-cookies [--target <t_id>]
camo set-cookies --cookies '<json-array>' [--target <t_id>]
camo set-user-agent --ua <string> [--target <t_id>]
camo set-viewport --width <px> --height <px> [--target <t_id>]
camo upload --selector <css> --file <path> [--target <t_id>]
camo select --selector <css> --value <value> [--target <t_id>]
```

`new-tab` and `multi-open` return newly allocated stable target/page ids.
`list-tabs` and `switch-tab` return stable target/page information; array
position is presentation only.

## Profiles and temporary state

Explicit `--profile` wins. When omitted, `CAMO_PROFILE` is used, then
`default`. A persistent profile keeps its data under
`~/.camo/profiles/<profile>/`. `close-tab` closes a page but never deletes
profile data. Only `stop` owns temporary-profile cleanup.

## Development

```bash
npm run test:v2
npm test
npm run test:all
npm run gates
npm run check:file-size
npm pack --dry-run --json
```

The v2 resource registry is the machine truth for ownership and verification:

- `v2/resources/registry/`
- `v2/docs/function_map.json`
- `v2/docs/mainline_call_map.json`
- `v2/docs/feature_tests.json`
- `v2/docs/verification/`

The Codex skill lives at `skills/camoufox`.
