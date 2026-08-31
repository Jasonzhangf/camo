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

## Offscreen click delivery

`mouse.wheel()` acknowledges dispatch before scrolling has finished. An offscreen
click therefore anchors the pointer once, then requires two stable target geometry
samples after every wheel before it may click or dispatch another wheel. This
applies even while the settled target remains outside the viewport; repeated
pointer anchoring against an unsettled scroll is forbidden. Every horizontal and
vertical wheel component is capped at 120 pixels; larger center distances require
multiple acknowledged and settled wheel segments. Positive coverage includes
delayed settlement, a multi-wheel target, a target whose center enters the
viewport while its lower edge remains beneath fixed navigation, and a target
above a fixed header. Click admission requires the complete target box inside the
viewport, with a bounded vertical safety zone for fixed mobile chrome. An
offscreen target's wheel direction aims its center at the viewport center instead
of stopping at the nearest edge, but never sends the whole center distance as one
wheel dispatch. Negative coverage keeps target geometry moving and requires an
explicit click failure with no mouse down/up event. DOM injection, locator click,
caller retry, and fixed-success reporting remain forbidden.
