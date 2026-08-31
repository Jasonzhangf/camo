# Camo mouse protocol liveness test design

## Lifecycle under test

`CLI parent -> detached daemon process -> Camoufox context -> serialized protocol mouse input`

The CLI parent may exit after daemon registration. Its stdout/stderr lifetime must
not control the daemon. Camoufox native humanization must stay disabled because
Camo already owns protocol mouse, keyboard, and wheel sequencing.

## White-box gates

- Both CLI daemon starters call one `spawnDaemonProcess` owner.
- Detached daemon stdio is `ignore`; no parent-owned output pipe survives CLI exit.
- Spawn preserves the caller environment while forcing daemon ports to dynamic `0`.
- Camoufox launch uses `humanize: false` and `i_know_what_im_doing: true`.
- The unsupported `iKnowWhatImDoing` option and direct caller `spawn()` copies are absent.

## Module and project black-box gates

- Start/status/stop a persistent daemon only through `camo`.
- Start two named profiles in the same daemon; both remain readable and accept
  protocol click and wheel input.
- Replay the original Claw product-card click and scroll through the preserved
  Camo profile.
- Stop each profile, then stop the singleton daemon through `camo`; no stale
  registration or active input lock may remain.

## Negative coverage

- A second profile must not create a second daemon.
- Parent CLI exit must not make a later daemon warning terminate the daemon.
- No timeout race, DOM injection, direct browser import, or input-pipeline fallback
  may be added to make a stalled command appear complete.

## Known diagnostic boundary

If protocol input returns a viewport error after the launch fixes, that is a new
first divergence. Capture page info, snapshot, screenshot, and target geometry on
the same profile before changing viewport or scrolling code.
