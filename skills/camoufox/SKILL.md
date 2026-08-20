---
name: camoufox
description: |
  Use the installed `camo` CLI for browser automation via one shared daemon. That daemon can host multiple named profiles; every `camo <cmd> --profile <id>` targets a profile inside the single daemon. Verified against `camo 0.4.2` (`camo --help` lists 32 commands).

  How to run camo (copy-paste, no need to read the body):

  # 1) Start the shared daemon (one process, hosts every profile)
  camo daemon start --profile mytask
  camo start --profile mytask --url https://example.com

  # 2) Use the profile for as many commands as you need
  camo get-page-info --profile mytask
  camo snapshot --profile mytask
  camo click --selector "h1" --profile mytask

  # 3) Switch profile inside the SAME daemon (stop old, start new)
  camo stop --profile mytask
  camo start --profile othertask --url https://opencode.ai/go

  # 4) Cleanup: stop the last profile, then stop the daemon
  camo stop --profile othertask
  camo daemon stop

  All browser operations go through `camo <cmd>`.
---

# Camo Browser CLI (Camoufox)

Use the installed `camo` binary only. This skill targets the installed
`camo` v2 / `0.4.2+` CLI. The single truth for command shape is
`camo --help` and `camo <cmd> --help`.

## Ground Truth (camo 0.4.2)

- **One shared daemon** (`camo daemon`) owns every browser session. `camo daemon start`
  must run before any browser command; `camo daemon stop` shuts the whole daemon down.
  Re-running `camo daemon start --profile <other>` while a daemon is alive returns
  `status: already_running` and never spawns a second daemon (`v2/commands/builtins/daemon.mjs`).
- **Local source checkout is `~/github/camo`** for verifying command shapes and daemon/profile behavior against the installed release.
- **Every command selects a profile.** Profile default resolution:
  explicit `--profile <id>` > `CAMO_PROFILE` env > `default`.
- **No `--profile` means `default`**, including `camo daemon start` and `camo start`.
  `default` is a persistent profile and is never auto-cleaned.
- **Multiple profiles live inside one daemon.** The daemon owns a profile-keyed
  browser registry (`_records` in `browser_service/internal/camoufox_bridge.mjs`).
  `camo start --profile <id>` creates/resumes that profile's browser and
  `camo stop --profile <id>` closes it. Do not start a second daemon per profile;
  `camo daemon start` is the singleton process, while `--profile` selects data and
  browser state.
- **Profile is the complete persistence unit**: every profile-scoped file lives under
  `~/.camo/profiles/<profile>/`. This includes `fingerprint.json`, Firefox
  `cookies.sqlite`, localStorage, browser state, and profile lock files.
  Root-layer `~/.camo/fingerprints/`, `~/.camo/cookies/<profile>/`, and
  `~/.camo/locks/` are legacy paths and must not be read or written.
- **Default login reuse is the recommended flow**: use `default` for the normal
  OpenCode + Google login. Keep the same `--profile default` for every login,
  navigation, stop, and restart command. After restart, the profile automatically
  reuses the same fingerprint and cookies; do not manually copy or inject cookies.
- **Every new named profile is isolated**: `~/.camo/profiles/<id>/` gets its own
  fingerprint and login state. Never mix cookies between profiles.
- **One daemon, explicit profile switching.** `shell.daemon` tracks one
  `currentBrowserProfile` scalar (`v2/shell/daemon/index.mjs`). To switch profile
  use `camo stop --profile <old>` then `camo start --profile <new>`; do not rely on
  implicit auto-close. Persistent browsers can also coexist in the daemon's
  profile-keyed registry and commands operate on the profile named by `--profile`,
  but the common deterministic flow is stop-old + start-new.
- **A session is started with `camo start` and stopped with `camo stop`.**
  Do not invent extra start/stop variants.
- **Login verification is evidence-based**: `camo get-cookies --profile <id>` must
  show the expected site cookies after login, and a stop/start cycle on the same
  profile must show them again. A URL alone is not proof of login.
- **Daemon autoshutdown**: persistent mode never idles out; ephemeral mode
  (`camo daemon start --ephemeral` or `camo daemon start --profile <id> --ephemeral`)
  auto-shuts after `CAMO_EPHEMERAL_IDLE_TIMEOUT` (default 30000 ms) of idle.
- **`camo doctor` is supported** for environment sanity checks; its JSON output
  reports the CLI version, protocol, and registry counts.

## Profile Rules（强制）

1. **Default to `default`** for login reuse unless the task explicitly needs an
   isolated login state. Never create a named profile just to "keep clean".
2. **One task = one profile.** Reuse the exact same `--profile` on every command.
   If a command fails, diagnose on the same profile; do not retry on a second profile.
3. **Multi-profile runs are explicit**: reuse `camo stop --profile <old>` and
   `camo start --profile <new>` for a clean task transition, or keep distinct
   `--profile` sessions alive and always pass `--profile` on every command.
   Never depend on implicit auto-close.
4. **Do not delete `default`.** Do not `rm -rf` profile directories unless the user
   explicitly asked to reset that exact profile.
5. **Never use positional profile arguments** (`camo goto <profile> <url>` is v1 syntax
   and does not exist in 0.4.2). Profile is always `--profile <id>`.

## Hard Constraints

- Allowed execution surface: `camo ...`. No Playwright, CDP, browser-use, direct
  browser-service imports, or ad-hoc wrappers.
- Do not inject DOM `click()`, `scrollTo()`, `history.back()`, or `value=`; use
  protocol commands only. Do not replace a failed command with `evaluate` or CDP.
- No fallback paths and no silent retry: surface command failures as-is.
- Never use broad process-kill commands (`pkill`, `killall`, `kill $(...)`).
- Do not run commands that `camo --help` does not list. If a v1 command
  (`init`, `profile create`, `sessions`, `status`, `events`, `container`,
  `autoscript`, `cleanup`, `force-stop`, `shutdown`, `back`, `new-page`,
  `cookies save`, `cookies load`, `viewport`, `highlight`, `clear-highlight`,
  `mouse click`, `mouse wheel`, ...) is suggested anywhere, it is stale and
  must be rewritten to the 0.4.2 command.

## Verify First

```bash
camo --version
camo --help
camo doctor
```

Expected version: `0.4.2+`. `camo doctor` writes JSON with the CLI count,
protocol id, and any v1 leftovers.

## Standard Execution Order

Use one profile throughout. For OpenCode + Google login, the default
profile is the persistent target.

```bash
camo daemon start --profile default
camo start --profile default --url https://example.com
camo get-page-info --profile default
camo snapshot --profile default
camo stop --profile default
camo daemon stop
```

For multi-profile runs (one daemon), keep the profiles alive and always pass
`--profile`, or use the deterministic stop-old/start-new transition:

```bash
camo daemon start --profile taskA
camo start --profile taskA --url https://example.com
# ... use taskA ...
# ... use taskB (pass --profile explicitly; taskA may stay alive) ...
camo get-page-info --profile taskB
camo stop --profile taskA
camo stop --profile taskB

camo daemon stop
```

For an isolated disposable run, use an explicit ephemeral daemon:

```bash
camo daemon start --profile disposable-check --ephemeral
camo start --profile disposable-check --url https://example.com
camo get-page-info --profile disposable-check
camo stop --profile disposable-check
camo daemon stop
```

Notes:
- `camo daemon start --ephemeral` creates an `_ephemeral_*` profile; commands must
  still pass the exact generated profile id (from the daemon result) if they target it.
  Prefer the explicit named form above for multi-command checks.
- `camo stop` reports `stopped` for a missing session without throwing, but a
  mid-task failure should not trigger an immediate stop. First collect evidence
  (see Failure Protocol), then clean up.
- Cleanup is sequential: wait for `camo stop` to return, then run
  `camo daemon stop`. Never run them concurrently — a concurrent `camo stop`
  can hit a closed WS during daemon teardown.

## Recommended Login Flow (OpenCode + Google)

The recommended and only supported login flow is `camo login` against the
persistent `default` profile. Do not run any other camo command while
inside a `camo login`; treat it as the authoritative entry point.

```bash
# 1) Boot the daemon + browser on default (foreground so you can interact)
camo daemon start --profile default
camo login --profile default \
           --url https://auth.opencode.ai/login \
           --until-cookie-name authorization \
           --until-url opencode.ai/go \
           --timeout 600000

# 2) Add Google login on the SAME profile (do not change profile id)
camo new-tab --profile default --url https://accounts.google.com/
camo login --profile default \
           --url https://accounts.google.com/ \
           --until-cookie-name __Secure-3PSID \
           --until-url myaccount.google.com \
           --timeout 600000

# 3) Verify both logins persisted
camo get-cookies --profile default
# Expect: cookies.google.com + accounts.google.com + auth.opencode.ai + opencode.ai

# 4) Stop the browser, then the daemon
camo stop --profile default
camo daemon stop
```

### Login completion signals (use at least one)

| Flag                 | Required | When to use |
|----------------------|----------|-------------|
| `--until-url`        | optional | matches a URL substring that only the logged-in page has (e.g. `opencode.ai/go`, `myaccount.google.com`) |
| `--until-cookie-name`| recommended | matches a cookie name that is only issued post-login (e.g. `authorization`, `__Secure-3PSID`). The cookie value must change since login started — a stale match is rejected. |
| `--timeout`          | optional | max wait ms (default 300000 = 5 minutes) |

### Restart reuse

After `camo stop` + `camo daemon stop`, rerun:

```bash
camo daemon start --profile default
camo start --profile default --url https://auth.opencode.ai/login
# opencode.ai/google cookies should be already loaded by Camoufox
camo get-cookies --profile default
```

Verified (2026-08-13): default profile holds `authorization`/`provider` on
`auth.opencode.ai`, `auth` on `opencode.ai`, and 27 Google cookies across
`.google.com`/`accounts.google.com`/`myaccount.google.com`/`gds.google.com`/
`ogs.google.com`. Reopening the same profile reuses these without re-login.

## Command Reference (0.4.2)

Flag names use the registry spelling: `--profile`, `--selector`, `--text`,
`--waitUntil`, `--format`, `--path`, `--for`, `--target`, `--timeout`, `--ms`,
`--delay`, `--script`, `--tabId`, `--scrollCount`, `--max-results`.

### Daemon and session lifecycle

```bash
camo daemon start [--profile <id>] [--ephemeral]
camo daemon status [--profile <id>]
camo daemon stop  [--profile <id>]
camo start [--profile <id>] [--url <https://...>] [--headless] [--ephemeral]
camo stop  [--profile <id>]
camo doctor
```

- `start` returns a session id; the session is addressed by profile afterwards.
- `stop` stops the browser session for that profile. `daemon stop` shuts the daemon.
- `camo login --profile <id> --url <url> --until-url <substr>|--until-cookie-name <name>`
  opens the browser in foreground and waits for the login completion signal.

### Navigation and page state

```bash
camo goto <url> [--profile <id>] [--waitUntil load|domcontentloaded|networkidle]
camo get-page-info [--profile <id>]
camo get-text [--selector <css>] [--profile <id>]
camo get-readable [--maxLength <n>] [--profile <id>]
camo find-elements [--selector <css>|--text <text>] [--profile <id>]
camo snapshot [--format json|yaml] [--profile <id>]
camo screenshot [--path <file>] [--profile <id>]
camo fetch-page <url> [--timeout <ms>] [--profile <id>]
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

### Tabs, cookies, browser settings

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

### Multi-URL sequence

```bash
camo multi-open --urls "https://a.com,https://b.com,https://c.com" \
                [--out-dir <dir>] [--prefix <name>] [--profile <id>]
```

Open every URL in deterministic tab order and capture a screenshot for each tab.
On failure, the tabs created by this command are closed and the command returns
`E_BROWSER_MULTIOPEN_FAILED`.

### Search

```bash
camo search <platform> <query> [--max-results <n>] [--cookies <file>] [--profile <id>]
```

`camo search` runs in-process (it is a standalone command) and supports the
platforms registered by the installed build (`xhs` in current source).

## Failure Protocol（运行出错时先取证）

Do not stop the profile first and do not switch to a second profile. Stay on the
same profile and collect evidence in this order:

1. `camo get-page-info --profile <id>` — current URL/title/viewport.
2. `camo snapshot --profile <id>` — page state.
3. `camo screenshot --profile <id> --path /tmp/camo-failure.png` — visual evidence.
4. `camo find-elements --profile <id> --selector <css>` — verify the target exists.
5. Read `~/.camo/runs/` for the event trail:
   - daemon events: `~/.camo/runs/run-<pid>-<ts>/events.jsonl`
   - browser_service events: `~/.camo/runs/run-default/events.jsonl`
   `grep 'command.error'` the newest run log for the exact error code.

Common errors and the correct response:

- `E_STATE_DUPLICATE`: a session already exists for the profile. Do not start a
  second one. Inspect the existing session on the same profile; only then decide
  `camo stop` + fresh `camo start`.
- `E_BROWSER_TYPE_FAILED` / `type.error`: typing failed on the live page. Take a
  snapshot/screenshot first; verify the selector and that the input is visible;
  retry `camo type` on the same profile. Do not fall back to DOM injection.
- `find-elements ... not a valid selector`: the selector syntax is CSS. Do not use
  v1 pseudo-selectors like `:visible` or comma-joined "engine" lists.
- `goto.error ... timeout`: the page did not reach the requested `--waitUntil`
  within the timeout. Get page info/snapshot; retry with `--waitUntil domcontentloaded`
  on the same profile rather than a new profile or `networkidle`.
- `camo daemon stop` returns `E_DAEMON_STOP_FAILED ... pid still alive after SIGTERM + 5s`:
  browser teardown can take longer than the 5s wait. Run `camo daemon status`;
  if it reports `not_running`, shutdown already succeeded. If it still reports
  `running`, re-run `camo daemon stop` once.

## Environment

| Variable | Meaning |
|---|---|
| `CAMO_PROFILE=<id>` | Default profile for every command when `--profile` is omitted |
| `CAMO_HEADLESS=1` | Launch browser instances headlessly |
| `CAMO_AUTOSTART=1` | Auto-start daemon if not running |
| `CAMO_WS_PORT` / `CAMO_HTTP_PORT` | Daemon ports (default 0 = auto-assign) |
| `CAMO_EPHEMERAL_IDLE_TIMEOUT` | ms before ephemeral daemon auto-shuts (default 30000) |

## Daemon / Profile Model (hard truth)

- One daemon, one claim: `~/.camo/daemon/.shared-daemon.claim` is the only active
  daemon owner. `camo daemon start --profile <id>` never starts a second daemon;
  it returns `already_running` when one is alive.
- Multiple profiles are hosted by that one daemon: `~/.camo/profiles/<id>/` is the
  per-profile data/persistence unit; the daemon's browser-service registry is
  keyed by profile id.
- For a clean per-task handoff use `camo stop --profile <old>` then
  `camo start --profile <new>` on the same daemon. For genuinely parallel
  profile state, keep both alive and always qualify every command with
  `--profile <id>`.
- Source truth: `v2/commands/builtins/daemon.mjs`, `v2/services/browser_service/
  internal/camoufox_bridge.mjs`, `v2/shell/daemon/index.mjs`.

## Behavior & Limits

- Browser data lives in `~/.camo/profiles/<profile>/` and is persistent per profile.
- One daemon at a time: `~/.camo/daemon/.shared-daemon.claim` records the active PID.
- The browser registry inside one daemon is keyed by `profileId`, so the daemon
  can own multiple profiles. `shell.daemon` still tracks a single
  `currentBrowserProfile` for lifecycle bookkeeping, so use `--profile` explicitly
  and stop profiles you no longer need.
- Profile lock prevents two runtimes on the same profile; stale locks are cleaned
  automatically by the daemon.
- Do not delete or "repair" `~/.camo/daemon/*.json` by hand. Use
  `camo daemon stop` / `camo daemon start` for lifecycle issues.
