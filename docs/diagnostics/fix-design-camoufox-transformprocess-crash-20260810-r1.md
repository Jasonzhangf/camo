# Camoufox TransformProcessType Crash Diagnosis

- debug_id: `DEBUG-camoufox-transformprocess-crash-20260810-r1`
- design_id: `FIX-camoufox-transformprocess-crash-20260810-r1`
- status: `APPROVED_BY_JASON`

```yaml
symptom:
  observed: >-
    Camoufox 152.0.4-beta.28 intermittently aborts on its main thread during
    startup at abort -> _RegisterApplication -> TransformProcessType.
  expected: >-
    One Camoufox runtime may own a profile data directory; conflicting startup
    attempts must fail before another browser process is launched.
  entry: camo CLI and shared daemon browser startup
  ids:
    crash_reports: 28
    concentrated_profile: default
  raw_evidence:
    - ~/Library/Logs/DiagnosticReports/camoufox-*.ips
    - ~/.camo/runs/run-default/events.jsonl
    - /private/tmp/camo-lifecycle-review-fix-20260809/playground/camoufox-startup-crash-20260809.md
workspace:
  canonical_path: /Users/fanzhang/Documents/github/camo
  base_commit: f4663a04ebb436039bd9bb6176c3fd8b67226a13
  experiment_worktree: /private/tmp/camo-crash-debug-20260810
  experiment_branch: detached HEAD
flow_model:
  status: known
  flow_id: browser.runtime.ownership
  source_docs:
    - v2/resources/registry/resources.json
    - v2/docs/function_map.json
    - v2/docs/mainline_call_map.json
    - v2/docs/feature_tests.json
  lifecycle_nodes:
    - shell command reaches shared daemon
    - browser_service.startSession acquires the CLI-facing profile lock
    - camoufox_bridge.launchBrowser acquires ProfileLock
    - engine-manager launches a persistent Camoufox context with the profile data_dir
    - Camoufox registers with macOS LaunchServices
    - browser/session truth is published
  resource_edges:
    - browser_service -> browser_service.internal
    - camoufox_bridge -> ProfileLock
    - camoufox_bridge -> engine-manager
    - engine-manager -> Camoufox persistent context
  forbidden_edges:
    - concurrent Camoufox processes -> same profile data_dir
    - shell.daemon -> browser_service.internal
  owner_graph:
    browser_instance: v2/services/browser_service/internal/camoufox_bridge.mjs
    internal_profile_lock: v2/services/browser_service/internal/ProfileLock.mjs
    engine_launch: v2/services/browser_service/internal/engine-manager.mjs
hypotheses:
  - id: H1
    cause: >-
      ProfileLock.acquire treats a live holder as disposable, sends SIGTERM and
      possibly SIGKILL, then removes/replaces the lock without proving exclusive
      ownership before launching another Camoufox against the same data_dir.
    modules:
      - v2/services/browser_service/internal/ProfileLock.mjs
      - v2/services/browser_service/internal/camoufox_bridge.mjs
    supporting_evidence: >-
      The 03:03-03:07 window has repeated session.start events for profile
      default without session.started, while fresh named profiles start
      successfully. ProfileLock source unconditionally takes over live holders.
    counter_evidence_or_gap: >-
      A controlled isolated reproduction and reverse intervention have not yet
      established that this ownership violation is sufficient for the macOS abort.
    verification_action: >-
      Run two isolated launch owners against one profile root, capture the
      ownership timeline and crash-report delta, then repeat with live-holder
      takeover changed to a typed lock rejection in the experiment worktree.
    confidence: 80
  - id: H2
    cause: >-
      The node parent exits while Camoufox is still performing LaunchServices
      registration, leaving the child without an application ASN.
    modules:
      - v2/commands/builtins/daemon.mjs
      - v2/shell/daemon/index.mjs
    supporting_evidence: startup abort occurs roughly 30 milliseconds after launch
    counter_evidence_or_gap: detached daemons and isolated launches also succeed
    verification_action: terminate only the explicit isolated parent PID during startup
    confidence: 45
  - id: H3
    cause: stale Firefox .parentlock or .startup-incomplete marker causes the abort
    modules:
      - Camoufox profile data directory
    supporting_evidence: several failed profiles retain these markers
    counter_evidence_or_gap: many successful/stopped profiles also retain .parentlock
    verification_action: replay a copied profile before and after marker removal
    confidence: 20
active_hypothesis: H1 (ownership defect formally approved; host LaunchServices crash remains operational)
experiment:
  experiment_id: EXP-H2-01
  experiment_type: fault_injection
  changed_paths: []
  expected_confirmation: >-
    Terminating only the explicit isolated node parent after Camoufox spawn but
    before LaunchServices registration produces a new TransformProcessType
    crash report with that node as parent.
  expected_falsification: >-
    Camoufox exits without that crash signature across repeated controlled
    pre-registration parent termination, or the same signature appears while
    the node parent stays alive.
  command: pending H2 timing harness
  observed_result: node parent remained alive in both crash samples; LaunchServices denied node and camoufox
  conclusion: H2 falsified; the abort is outside camo authority and requires unsandboxed execution
first_divergence_node: >-
  H1 confirmed a contract divergence at ProfileLock.acquire: a live foreign
  profile owner is treated as a termination target instead of an exclusive
  holder. Sufficiency for the macOS abort remains pending H2.
positive_intervention_evidence: >-
  /private/tmp/camo-h1-bridge-guarded.4nfl2o: second owner returned
  E_STATE_LOCKED; first owner remained alive and exited 0.
reverse_intervention_evidence: >-
  /private/tmp/camo-h1-bridge-reverse.NJSBWE: restoring takeover killed the
  first owner (exit 137) and allowed the second browser to start.
root_cause_module: pending crash-sufficiency proof
unique_owner: pending crash-sufficiency proof
allowed_paths: []
forbidden_paths:
  - canonical runtime source during diagnosis
  - production ~/.camo profile data during experiment
required_verification:
  - positive and negative lock ownership tests
  - concurrent same-profile real Camoufox replay
  - distinct-profile concurrency replay
  - crash-report delta check
  - installed CLI and shared-daemon replay
exact_replay: repeated same-profile default startup burst through camo entry
```

H1 causally proves the internal ownership defect but did not increment the
Camoufox crash-report count (23 before and after each round). H2 was then
falsified by live system-log correlation. Experimental changes are not release
input.

## 2026-08-10 root-cause closeout

- H1 confirmed as an ownership-contract defect in ProfileLock.acquire (a live foreign holder is killed
  and replaced instead of rejected); it does not by itself reproduce the macOS abort.
- H2 falsified: both crash logs show the node parent alive; the abort is not caused by killing the node
  parent during LaunchServices registration.
- Root cause: macOS LaunchServices denies the `com.apple.coreservices.launchservicesd` mach-lookup to both
  the sandboxed node parent and the spawned camoufox child (`error=159 Sandbox restriction`); camoufox
  `_RegisterApplication` then aborts in `TransformProcessType`. This matches the public sandbox failure
  class in openai/codex#30043 and AvaloniaUI/Avalonia#6529; it is a host/sandbox limitation, not a camo
  code defect.
- Operational rule: real-browser camo automation must run from an unsandboxed host process (Claw canonical
  or terminal). Inside the codex sandbox every Camoufox launch will abort at LaunchServices registration.
- `~/.camo/profiles/default/camo-profile.json` had `profileId` overwritten to `onestop-canonical`, which
  explains the `E_IO_FILESYSTEM profileId mismatch` noise but is not the crash root cause.

## Approval-ready formal scope

The macOS `TransformProcessType` abort is host sandbox behavior and cannot be
repaired inside camo without violating the single-owner/no-fallback boundary.
The formal camo change is limited to the independently confirmed ownership
contract defect:

- unique owner: `v2/services/browser_service/internal/ProfileLock.mjs`
- allowed paths: that owner, its direct bootstrap cleanup call sites only when
  required by the lock contract, and paired lock tests
- forbidden paths: Camoufox binary/profile data, LaunchServices/TCC state,
  OneStop business code, caller retries, silent fallback, and sandbox bypasses
- live foreign holder: return typed `E_STATE_LOCKED`; never signal or replace it
- stale holder: reclaim only after an explicit dead-PID check
- release: unlink only when the lock payload owner is the current process

Required red/green pairs:

1. live same-profile second acquire fails with `E_STATE_LOCKED`, first owner
   remains alive, and the lock file is unchanged;
2. dead-PID lock is reusable and the new owner can release it;
3. a non-owner release cannot remove the live owner's lock;
4. distinct profiles remain independently acquirable;
5. exact same-profile Camoufox replay shows no second process is launched after
   the typed rejection.

The LaunchServices crash itself must be prevented operationally by running the
global camo CLI from an unsandboxed Claw/terminal host. A preflight probe is not
part of this design because the system denial is outside camo's authority and a
probe cannot make the denied launch succeed.

Approval gate: Jason approved
`FIX-camoufox-transformprocess-crash-20260810-r1`. Formal edits and verification
must remain inside the approved scope; live Camoufox replay must run from an
unsandboxed Claw/terminal host.

## 2026-08-10 approval and implementation start

- Jason explicitly approved `FIX-camoufox-transformprocess-crash-20260810-r1`
  after reviewing the root-cause analysis and the formal scope.
- Implementation scope is now unlocked: edits stay inside
  `v2/services/browser_service/internal/ProfileLock.mjs` and its paired tests.
- Paired red tests were authored in the isolated experiment worktree
  `/private/tmp/camo-crash-debug-20260810/playground/camoufox-transformprocess-crash/profile-lock-red.test.mjs`
  and confirmed to fail against the current runtime (3/5 red).
- Formal fix and verification are tracked in
  `.agent-collab/runs/20260810T044345Z-Macstudio-52163-camocrash/events.jsonl`.

## 2026-08-10 review-driven closeout (round 2)

First `codex -p cc review` returned no `VERDICT:` line (invalid PASS) with
P2 findings that are closed inside this same approved design:

1. PID-reuse availability hole: `ProfileLock.acquire()` now records
   `processIdentity` (from `daemon_registration::getProcessIdentity`) in the
   lock payload. A live PID is reclaimed only when its recorded identity
   proves the original owner generation is gone; legacy locks without an
   identity still fail closed for live PIDs, and dead PIDs remain reclaimable.
2. Verification-map lockstep: `v2/docs/feature_tests.json` registers
   `browser.runtime.ownership` with the paired ProfileLock test file as both
   positive and negative; `v2/resources/registry/edges.json` declares
   `services.browser_service.internal -> services.daemon_registration`;
   `v2/docs/mainline_call_map.json` records
   `ProfileLock.acquire -> getProcessIdentity`; wiki projections are
   regenerated from the JSON truth.
3. Approval-state sync: `note.md` now records
   `APPROVED_BY_JASON` instead of the stale `AWAITING_APPROVAL` gate.
4. Scratch scripts `_diag_weibo2.mjs` and `test-camoufox-direct.mjs` are
   moved out of the worktree (backup `/tmp/camo-scratch-remove-20260810/`);
   they bypass the camo CLI and are not part of the commit or release
   evidence.

Allowed paths after review corrections: `ProfileLock.mjs` owner, its paired
unit tests, and the map-truth lockstep files named above. Forbidden paths
remain unchanged: Camoufox binary/profile data, LaunchServices/TCC state,
OneStop business code, caller retries, silent fallback, and sandbox bypasses.
