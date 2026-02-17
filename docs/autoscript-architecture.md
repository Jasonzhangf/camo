# Autoscript Architecture (Camo)

## 1. Design Goal

Camo automation is split into two layers:

- Base Runtime Layer: stateless primitives for current-page operations only.
- Script Layer (autoscript): orchestration strategies (retry, dependency, impact, recovery flow).

This keeps recovery policies and failure propagation out of base modules.

## 2. Layer Boundary

### 2.1 Base Runtime Layer (no strategy)

Responsibilities:

- Subscription detection: appear/exist/disappear/change.
- Single operation execution on current page.
- Tab/session primitives for deterministic multi-tab orchestration.
- Operation validation primitives (page/container checks).
- Checkpoint primitives (detect/capture/restore action).

Non-responsibilities:

- Retry loop decisions.
- Dependency graph scheduling.
- Failure impact propagation.
- Global workflow stop/continue policy.

### 2.2 Script Layer (strategy only)

Responsibilities:

- Operation DAG orchestration.
- Per-subscription and per-operation retry policy.
- Dependency resolution.
- Failure impact propagation (`op | subscription | script`).
- Recovery strategy sequencing using base checkpoint actions.

## 3. CLI Surface

- `camo autoscript validate <file>`: syntax + semantic validation.
- `camo autoscript explain <file>`: expanded graph and normalized defaults.
- `camo autoscript run <file> [--profile <id>]`: execute script runtime.

`camo container watch` remains base mode and no longer owns autoscript orchestration.

## 4. Base Runtime API

`src/container/runtime-core.mjs` exports:

- `ensureActiveSession(profileId)`
- `watchSubscriptions({ profileId, subscriptions, throttle, onEvent, onError })`
- `executeOperation({ profileId, operation, context })`
- `executeOperation` supports base primitives:
  - page ops: `goto`, `back`, `wait`, `evaluate`, `click`, `type`, `scroll_into_view`
  - tab ops: `list_pages`, `new_page`, `switch_page`, `ensure_tab_pool`, `tab_pool_switch_next`, `tab_pool_switch_slot`
- `validateOperation({ profileId, validationSpec, phase, context })`
- `detectCheckpoint({ profileId, platform })`
- `captureCheckpoint({ profileId, containerId, selector, platform })`
- `restoreCheckpoint({ profileId, checkpoint, action, containerId, selector, targetCheckpoint })`

All APIs return structured payloads and leave strategy choices to callers.

## 5. Autoscript Definition

```json
{
  "version": 1,
  "name": "xhs-flow",
  "profileId": "xiaohongshu-batch-1",
  "throttle": 500,
  "defaults": {
    "retry": { "attempts": 1, "backoffMs": 500 },
    "impact": "op",
    "validationMode": "both",
    "recovery": { "attempts": 2, "actions": ["requery_container", "scroll_into_view", "page_back", "goto_checkpoint_url"] }
  },
  "subscriptions": [
    {
      "id": "search_input",
      "selector": "#search-input",
      "events": ["appear", "exist"],
      "dependsOn": [],
      "retry": { "attempts": 1, "backoffMs": 300 },
      "impact": "subscription"
    }
  ],
  "operations": [
    {
      "id": "fill_keyword",
      "action": "type",
      "params": { "selector": "#search-input", "text": "手机膜" },
      "trigger": "search_input.appear",
      "dependsOn": [],
      "conditions": [],
      "retry": { "attempts": 1, "backoffMs": 500 },
      "impact": "op",
      "onFailure": "chain_stop",
      "validate": {
        "mode": "both",
        "pre": { "page": { "hostIncludes": ["xiaohongshu.com"] } },
        "post": { "container": { "selector": "#search-input", "mustExist": true, "minCount": 1 } }
      },
      "checkpoint": {
        "containerId": "xiaohongshu_home.search_input",
        "targetCheckpoint": "search_ready",
        "recovery": { "attempts": 2, "actions": ["requery_container", "scroll_into_view", "page_back", "goto_checkpoint_url"] }
      }
    }
  ]
}
```

## 6. Failure Semantics

- Normal execution failure: chain-level stop (`chain_stop`) by default.
- Recovery budget exhausted: escalation follows operation/script impact.
- `impact=script` or `onFailure=stop_all`: stop the whole autoscript runtime.

## 7. Recovery Model

Base layer exposes atomic actions only:

- `requery_container`
- `scroll_into_view`
- `page_back`
- `goto_checkpoint_url`

Script layer composes these actions and retry budgets.

## 7.1 Anti-Risk Pacing Model

- `defaults.pacing` and `operation.pacing` are script-level strategy controls:
  - `operationMinIntervalMs`: minimum interval between runs of the same operation.
  - `eventCooldownMs`: minimum interval for repeated trigger events.
  - `jitterMs`: random wait inserted before execution.
  - `navigationMinIntervalMs`: cooldown between navigation/tab-switch actions.
  - `timeoutMs`: operation timeout budget.
- Runtime deduplicates `subscription.exist` triggers by appear-cycle so stable DOM does not repeatedly execute heavy operations.

## 8. Checkpoint Model (Xiaohongshu)

Checkpoint labels:

- `search_ready`
- `home_ready`
- `detail_ready`
- `comments_ready`
- `login_guard`
- `risk_control`
- `offsite`
- `unknown`

`detectCheckpoint` is heuristic and deterministic from page facts; scripts decide what to do when checkpoints mismatch.

## 9. Observability

Runtime emits JSON logs with stable fields:

- `runId`
- `profileId`
- `subscriptionId`
- `operationId`
- `event`
- `status`
- `latencyMs`
- `code`

## 10. Migration Mapping (webauto/scripts/xiaohongshu)

- `runtime-ready` + `checkpoints` => base checkpoint primitives.
- `Phase34OpenDetail` validation => operation `validate.post`.
- `phase-unified-harvest` operation plan => autoscript DAG.
- `recordStageRecovery/stage_check` => autoscript events.

## 11. Acceptance Criteria

- Base layer contains no strategy branching (retry/impact/policy).
- Script layer fully controls retry/dependency/impact/recovery.
- `autoscript validate` catches unresolved references and cycles.
- `container watch` works in base mode independent of autoscript.
