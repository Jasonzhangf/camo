# Fix Design: profile-data-unification (2026-08-13 r1)

## Symptom
- `~/.camo/fingerprints/<id>.json`, `~/.camo/cookies/<id>/*.json|.txt`, `~/.camo/locks/<id>.lock` live at root layer.
- Spec required: ALL profile-scoped data lives under `~/.camo/profiles/<id>/`; root layer must not read or write any per-profile data.
- default fingerprint's `timezoneId: Asia/Shanghai` does not match current host (`America/Los_Angeles`).
- No ephemeral "temp" lifecycle: `stop` never removes the profile directory.

## Flow
Known flow: `browser.lifecycle.persistent` + new `browser.lifecycle.ephemeral_temp`.

## Owner & Scope Lock
- Root sources to edit (single owner each):
  - `v2/services/browser_service/internal/fingerprint.mjs` (fingerprint path + host-real fingerprint)
  - `v2/services/browser_service/internal/storage-paths.mjs` (drop `resolveCookiesRoot`, `resolveLocksRoot`; add `resolveProfilePath(profileId, kind)`)
  - `v2/services/browser_service/internal/ProfileLock.mjs` (lock file under profile dir)
  - `v2/core/browser/CookieStore.mjs` (root -> profile-internal storage)
  - `v2/resources/browser/BrowserInstance.mjs` (`COOKIE_DIR` source)
  - `v2/services/browser_service/bootstrap.mjs` (ephemeral temp: start dir allocation, stop rm -rf)
  - `v2/shell/daemon/command_handlers.mjs` + `v2/shell/daemon/index.mjs` (start command accepts `--ephemeral`; temp alias resolution; stop removes temp dir; daemon stop sweep)
  - `v2/commands/builtins/start.mjs` + `v2/commands/builtins/stop.mjs` (pass ephemeral flag)
  - `v2/commands/registry/registry.json` (register ephemeral flag on start)
  - `v2/tests/unit/services/browser_service.bootstrap.test.mjs` + multi_profile + `core/cookie_store.test.mjs` + `core/browser_instance_cookie.test.mjs` (update paths)
- Forbidden:
  - Writing to `~/.camo/fingerprints/`, `~/.camo/cookies/<id>/`, `~/.camo/locks/<id>.lock`, `~/.camo/profile-locks/`.
  - Modifying `~/.camo/profiles/default/cookies.sqlite` or any other live default data.

## Host-Real Fingerprint
- TZ: `America/Los_Angeles`
- UA / platform / language / cores / vendor match current `default.json` (kept stable on regenerate; only TZ differs).
- On regenerate: fingerprint hash salt will change; this is OK and intentional per spec ("重新建立新的").

## Ephemeral Temp Profile Rules
- `camo start --profile temp` -> daemon allocates `~/.camo/profiles/_temp_<pid>_<ts>/` directory; fingerprint written inside.
- All camo data (browser cookies.sqlite, fingerprint.json, profile lock file) lives inside that directory.
- `camo stop --profile temp` -> closes browser, releases lock, deletes directory.
- `camo daemon stop` -> after shutdown, scans `~/.camo/profiles/_temp_*` and rm -rf any not currently held.

## Verification
1. `pnpm test v2/tests/unit/services/browser_service.bootstrap.test.mjs v2/tests/unit/services/browser_service.bootstrap.multi_profile.test.mjs v2/tests/unit/core/cookie_store.test.mjs v2/tests/unit/core/browser_instance_cookie.test.mjs` all green.
2. `camo start --profile temp --url https://www.google.com` then `camo stop --profile temp`; verify `_temp_<pid>_<ts>` is created then removed; verify no write to root layer.
3. `camo stop --profile default` then `camo start --profile default --url https://www.google.com`; verify fingerprint regenerated (TZ=America/Los_Angeles), cookies.sqlite preserved.

## Out of Scope
- Migrating legacy `~/.camo/fingerprints/default.json`.
- vitest 75-file "No test suite found" infrastructure issue.
- ChatGPT voice network config.