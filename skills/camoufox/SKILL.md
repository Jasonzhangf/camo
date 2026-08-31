---
name: camoufox
description: |
  Use the installed `camo` CLI for browser automation via one shared daemon. That daemon can host multiple named profiles; every `camo <cmd> --profile <id>` targets a profile inside the single daemon. Verified against `camo 0.4.3` (`camo --help` lists 32 commands).

  How to run camo (copy-paste, no need to read the body):

  # 1) Start the shared daemon and persistent default profile
  camo daemon start
  camo start --url https://example.com

  # 2) Use the implicit default profile for as many commands as you need
  camo get-page-info
  camo snapshot
  camo click --selector "h1"

  # 3) Stop the default session, then the daemon
  camo stop
  camo daemon stop

  # For a concrete isolated task, use an explicit profile in the SAME daemon
  camo start --profile othertask --url https://opencode.ai/go

  # Cleanup the isolated profile, then stop the daemon
  camo stop --profile othertask
  camo daemon stop

  Profiles idle for 30 minutes auto-close their browser, but keep data under
  ~/.camo/profiles/<id>/; the shared daemon stays running.

  All browser operations go through `camo <cmd>`.
---

# Camo Browser CLI (Camoufox)

Use the installed `camo` binary only. This skill targets the installed
`camo` v2 / `0.4.3+` CLI. The single truth for command shape is
`camo --help` and `camo <cmd> --help`.

## Ground Truth (camo 0.4.3)

- **One shared daemon** (`camo daemon`) owns every browser session. `camo daemon start`
  must run before any browser command; `camo daemon stop` shuts the whole daemon down.
  Re-running `camo daemon start --profile <other>` while a daemon is alive returns
  `status: already_running` and never spawns a second daemon (`v2/commands/builtins/daemon.mjs`).
- **Local source checkout is `~/github/camo`** for verifying command shapes and daemon/profile behavior against the installed release.
- **Every command selects a profile.** Profile default resolution:
  explicit `--profile <id>` > `CAMO_PROFILE` env > `default`.
- **No `--profile` means `default`**, including `camo daemon start` and `camo start`.
  This is an implicit profile parameter: omission resolves to the literal
  `default` profile. An explicit `--profile <id>` always wins and must never
  inherit or copy state from `default`.
  `default` profile data is persistent; its browser follows the same idle reclaim
  policy as other persistent profiles.
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
- **Default profile is the implicit `default` parameter**: when `--profile` is
  omitted, the command targets the persistent `default` profile as an implicit
  parameter. This does NOT identify the profile as "the Weibo profile" or
  "the Xiaohongshu profile" — `default` is simply the persistent default profile
  whose persisted state currently holds Weibo (微博) and Xiaohongshu / XHS
  (小红书) login cookies. Persisted cookies alone are not a live login guarantee:
  before relying on the Weibo or Xiaohongshu session, re-verify via
  `camo get-cookies --profile default` plus a page-state check
  (`camo goto https://weibo.com/newlogin` or
  `camo goto https://www.xiaohongshu.com/explore`), or re-run `camo login`
  against the same implicit default. The default profile may also hold
  login cookies for other platforms (e.g. OpenCode, Google); treat those the
  same way. Keep the same implicit default selection for login, navigation,
  stop, and restart; after restart, the profile reuses its fingerprint and
  cookies automatically. Do not manually copy or inject cookies from `default`
  into another profile. An explicit `--profile <id>` is authoritative and
  never inherits or copies these sessions.
- **Every new named profile is isolated**: `~/.camo/profiles/<id>/` gets its own
  fingerprint and login state. Never mix cookies between profiles.
- **Temporary profiles are disposable and Camo-self-cleaned**: use
  `--profile temp` or explicit `--ephemeral` only for a concrete isolated
  or one-shot task. Camo allocates and returns the actual
  `_temp_<pid>_<timestamp>` profile id (the `start` response is the source
  of truth for the id; do not reconstruct it). Use that returned id for
  every subsequent command, then run `camo stop --profile temp`. Camo owns
  deletion of the temporary profile directory and does not retain residual
  `_temp_*` data: cleanup failures are errors, not successful stops.
  Verify by running `test ! -e "$HOME/.camo/profiles/<returned-id>"` after
  `camo stop --profile temp` — a missing directory is the only valid outcome.
- **One daemon, concurrent profile isolation.** The browser registry is keyed by
  profile id; multiple persistent profiles can remain active concurrently in the
  same daemon. Every agent command must pass its exact `--profile <id>` and never
  depend on daemon-global current-profile state. Use
  `camo stop --profile <id>` only to close that profile; it must not be used to
  switch profiles or stop another agent's session.
- **A session is started with `camo start` and stopped with `camo stop`.**
  Do not invent extra start/stop variants.
- **Login verification is evidence-based**: `camo get-cookies --profile <id>` must
  show the expected site cookies after login, and a stop/start cycle on the same
  profile must show them again. A URL alone is not proof of login.
- **Daemon autoshutdown**: ephemeral mode (`camo daemon start --ephemeral` or
  `camo daemon start --profile <id> --ephemeral`) auto-shuts after
  `CAMO_EPHEMERAL_IDLE_TIMEOUT` (default 30000 ms) of idle.
- **Per-profile idle auto-reclaim**: persistent profiles auto-close their browser
  after `CAMO_PROFILE_IDLE_TIMEOUT_MS` (default 1800000 ms / 30 min) without a
  command. The daemon stays alive; profile data under `~/.camo/profiles/<id>/`
  is preserved and the browser restarts on the next command. Sweep runs every
  `CAMO_PROFILE_IDLE_SWEEP_INTERVAL_MS`
  (default 60000 ms) and skips profiles with in-flight commands.
- **`camo doctor` is supported** for environment sanity checks; its JSON output
  reports the CLI version, protocol, and registry counts.

## Profile Rules（强制）

1. **Reuse an existing profile by default.** Unless the task explicitly
   requires isolated credentials, concurrent data boundaries, or another
   concrete profile-specific reason, do not create a new profile. In
   particular, do not create a new profile merely to use a platform that is
   already covered by the persistent `default` profile. Prefer `default` when
   its persisted state is the intended target. When `--profile` is omitted,
   `default` is selected implicitly; an explicit `--profile <id>` remains
   authoritative and does not inherit `default` login state.
2. **One task = one profile.** Reuse the exact same `--profile` on every command.
   If a command fails, diagnose on the same profile; do not retry on a second profile.
3. **Multi-profile runs are explicit**: keep distinct `--profile` sessions alive
   concurrently and always pass `--profile` on every command. Starting a new
   profile must not stop the previous profile.
4. **Do not delete `default`.** Do not `rm -rf` profile directories unless the user
   explicitly asked to reset that exact profile.
5. **Temporary profile cleanup is mandatory and self-owned.** A temporary
   profile is disposable and Camo owns its cleanup: after the task, stop it
   through Camo and verify the returned `_temp_*` directory is absent. Do not
   manually delete it, do not treat a cleanup exception as success, and do not
   accept a successful result that leaves residual temporary data. The
   temporary-profile path is valid only when both the requested operation and
   cleanup have been verified.
6. **Never use positional profile arguments** (`camo goto <profile> <url>` is v1 syntax
   and does not exist in 0.4.3). Profile is always `--profile <id>`.

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
  must be rewritten to the 0.4.3 command.

## Verify First

```bash
camo --version
camo --help
camo doctor
```

Expected version: `0.4.3+`. `camo doctor` writes JSON with the CLI count,
protocol id, and any v1 leftovers.

## Standard Execution Order

Use one profile throughout. For the normal logged-in flow, omit `--profile`
and use the persistent `default` profile implicitly.

```bash
camo daemon start
camo start --url https://example.com
camo get-page-info
camo snapshot
camo stop
camo daemon stop
```

For multi-profile runs (one daemon), keep the profiles alive and always pass
`--profile`:

```bash
camo daemon start --profile taskA
camo start --profile taskA --url https://example.com/a
camo start --profile taskB --url https://example.com/b
camo get-page-info --profile taskA
camo get-page-info --profile taskB
camo stop --profile taskA
camo stop --profile taskB

camo daemon stop
```

For an isolated disposable run, use a temporary profile:

```bash
camo daemon start
camo start --profile temp --headless --url https://example.com
# Save the returned profile, for example: _temp_12345_1735689600000
camo get-page-info --profile <returned-temp-id>
camo snapshot --profile <returned-temp-id>
camo stop --profile temp
test ! -e "$HOME/.camo/profiles/<returned-temp-id>"
camo daemon stop
```

Notes:
- `camo start --profile temp` creates a disposable `_temp_<pid>_<timestamp>`
  profile. The `start` response is the source of truth for the allocated id;
  do not reconstruct it.
- `camo stop --profile temp` resolves the current allocation and removes its
  profile directory. If removal fails, the command must fail visibly.
- `camo stop` reports `stopped` for a missing session without throwing, but a
  mid-task failure should not trigger an immediate stop. First collect evidence
  (see Failure Protocol), then clean up.
- Cleanup is sequential: wait for `camo stop` to return, then run
  `camo daemon stop`. Never run them concurrently — a concurrent `camo stop`
  can hit a closed WS during daemon teardown.

## Recommended Login Flow (OpenCode + Google)

The recommended and only supported login flow is `camo login` against the
persistent `default` profile selected implicitly by omitting `--profile`. Do
not run any other camo command while inside a `camo login`; treat it as the
authoritative entry point.

```bash
# 1) Boot the daemon + browser on default (foreground so you can interact)
camo daemon start
camo login \
  --url https://auth.opencode.ai/login \
  --until-cookie-name authorization \
  --until-url opencode.ai/go \
  --timeout 600000

# 2) Add Google login on the SAME profile (do not change profile id)
camo new-tab --url https://accounts.google.com/
camo login \
  --url https://accounts.google.com/ \
  --until-cookie-name __Secure-3PSID \
  --until-url myaccount.google.com \
  --timeout 600000

# 3) Verify both logins persisted
camo get-cookies
# Expect: cookies.google.com + accounts.google.com + auth.opencode.ai + opencode.ai

# 4) Stop the browser, then the daemon
camo stop
camo daemon stop
```

### Login completion signals (use at least one)

| Flag                 | Required | When to use |
|----------------------|----------|-------------|
| `--until-url`        | optional | matches a URL substring that only the logged-in page has (e.g. `opencode.ai/go`, `myaccount.google.com`) |
| `--until-cookie-name`| recommended | matches a cookie name that is only issued post-login (e.g. `authorization`, `__Secure-3PSID`). The cookie value must change since login started — a stale match is rejected. |
| `--timeout`          | optional | max wait ms (default 300000 = 5 minutes) |

### Restart reuse

After `camo stop` + `camo daemon stop`, rerun the same implicit-default flow:

```bash
camo daemon start
camo start --url https://auth.opencode.ai/login
# opencode.ai/google cookies should be already loaded by Camoufox
camo get-cookies
```

Verified (2026-08-13): default profile holds `authorization`/`provider` on
`auth.opencode.ai`, `auth` on `opencode.ai`, and 27 Google cookies across
`.google.com`/`accounts.google.com`/`myaccount.google.com`/`gds.google.com`/
`ogs.google.com`. Reopening the same profile reuses these without re-login.

## Command Reference (0.4.3)

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
camo back [--profile <id>]
camo forward [--profile <id>]
camo reload [--waitUntil load|domcontentloaded|networkidle|commit] [--profile <id>]
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
| `CAMO_PROFILE_IDLE_TIMEOUT_MS` | ms before a persistent profile browser auto-closes when idle (default 1800000) |
| `CAMO_PROFILE_IDLE_SWEEP_INTERVAL_MS` | ms between idle profile sweep checks (default 60000) |

## Daemon / Profile Model (hard truth)

- One daemon, one claim: `~/.camo/daemon/.shared-daemon.claim` is the only active
  daemon owner. `camo daemon start --profile <id>` never starts a second daemon;
  it returns `already_running` when one is alive.
- Multiple profiles are hosted by that one daemon: `~/.camo/profiles/<id>/` is the
  per-profile data/persistence unit; the daemon's browser-service registry is
  keyed by profile id.
- Keep parallel profile state alive in the same daemon and always qualify every
  command with `--profile <id>`. Stop only the exact profile being retired.
- Source truth: `v2/commands/builtins/daemon.mjs`, `v2/services/browser_service/
  internal/camoufox_bridge.mjs`, `v2/shell/daemon/index.mjs`.

## Behavior & Limits

- Browser data lives in `~/.camo/profiles/<profile>/` and is persistent per profile.
- One daemon at a time: `~/.camo/daemon/.shared-daemon.claim` records the active PID.
- The browser registry inside one daemon is keyed by `profileId`, so the daemon
  can own multiple profiles. `shell.daemon` does not stop or replace another
  profile when a new profile command arrives; use `--profile` explicitly and stop
  only profiles you no longer need.
- Idle persistent profiles are auto-reclaimed: the daemon closes a profile's
  browser after the configured idle timeout and preserves its profile data. A
  later `camo start --profile <id>` reopens the same profile.
- `camo daemon status` and `/health` report `browserCount` as the number of
  distinct active profile sessions, not a browser reference count; `/health`
  also lists `profiles`. Long-lived tasks that do not issue commands for the
  full idle timeout can be reclaimed by design; raise
  `CAMO_PROFILE_IDLE_TIMEOUT_MS` for such workloads.
- Profile lock prevents two runtimes on the same profile; stale locks are cleaned
  automatically by the daemon.
- Do not delete or "repair" `~/.camo/daemon/*.json` by hand. Use
  `camo daemon stop` / `camo daemon start` for lifecycle issues.
