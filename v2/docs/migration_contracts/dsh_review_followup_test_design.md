# DSH Review Follow-up Test Design

## Lifecycle

- `startSession(profile)` acquires the profile lock, then invokes
  `services.profile::migrateLegacyProfileData` before profile creation or
  browser launch.
- Legacy per-profile fingerprint and cookie-backup files move once into the
  profile-owned root. Successful migration removes the legacy copies.
- Any source/target conflict fails closed with a typed error; no target is
  overwritten and no partial migration begins.
- The daemon maps the literal alias `temp` to one allocated `_temp_*` profile.
  A second start reuses that exact profile; stop resolves and clears the map.
- A named `--ephemeral` request follows the same alias-to-allocation contract
  without creating or overwriting the literal `temp` alias.
- Lock directory scans skip names outside `PROFILE_ID_PATTERN`.
- Camoufox preflight reports installation readiness only. Browser launch
  verification remains owned by daemon browser-service runtime.

## White-box

- Fingerprint migration preserves bytes and removes the legacy file.
- Cookie migration puts Netscape `.txt` and `.lastVisit.json` in
  `cookie-backups`, keeps legacy BrowserInstance domain `.json` files readable
  from the profile root, rejects target conflicts before any move, and leaves
  unscoped global cookie files untouched.
- `CAMO_PROFILE_ROOT` is the documented target override; the legacy
  `CAMO_PATHS_PROFILES` alias may agree with it, but conflicting values fail.
- Stale temp alias truth fails with `E_STATE_INVALID`; it never allocates a
  second browser.
- Temp stop without an allocation fails with `E_STATE_NOT_FOUND`.
- Invalid profile directory names cannot abort `cleanupStale` or `listHeld`.
- Installation readiness always carries `launchVerified:false` and the launch
  owner; it never starts a browser process.

## Module black-box

- `start --profile temp` returns one allocated `_temp_*` id; repeated start
  returns the same id with `reused:true`; stop reports that exact id.
- Existing named profile startup runs migration before Camoufox reads its
  fingerprint path.
- Runtime launch failures are still surfaced by browser-service error envelopes.

## Project black-box

- Packed, globally installed CLI starts a real browser after readiness passes.
- A legacy fingerprint fixture is moved through the installed runtime and used
  by the launched profile; old and new paths are checked directly.
- No screenshot is required for this lifecycle smoke; page title/URL and profile
  files are sufficient semantic evidence.

## Known boundary

- Global `~/.camo/cookies/<domain>.txt` is not profile-scoped and is therefore
  not migrated automatically.
- This change does not implement the pending semantic page-structure design.
