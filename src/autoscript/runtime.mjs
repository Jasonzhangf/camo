import crypto from 'node:crypto';
import {
  captureCheckpoint,
  executeOperation,
  restoreCheckpoint,
  validateOperation,
  watchSubscriptions,
} from '../container/runtime-core.mjs';
import { executeAutoscriptAction } from './action-providers/index.mjs';
import { ImpactEngine } from './impact-engine.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function createRunId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function withTimeout(promise, timeoutMs, onTimeout) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((resolve) => {
      timer = setTimeout(() => {
        resolve(onTimeout());
      }, timeoutMs);
    }),
  ]);
}

function extractTerminalDoneCode(result) {
  const text = `${result?.code || ''} ${result?.message || ''}`;
  const matched = text.match(/AUTOSCRIPT_DONE_[A-Z_]+/);
  return matched ? matched[0] : null;
}

function normalizeExecutionResult(result) {
  if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
    return {
      ok: result.ok,
      code: result.code || (result.ok ? 'OPERATION_DONE' : 'OPERATION_FAILED'),
      message: result.message || (result.ok ? 'operation done' : 'operation failed'),
      data: result.data ?? result.result ?? null,
    };
  }
  return {
    ok: false,
    code: 'OPERATION_FAILED',
    message: 'invalid operation result payload',
    data: { resultType: typeof result },
  };
}

function mapToPlainObject(map) {
  return Object.fromEntries(map.entries());
}

function plainObjectToMap(value) {
  if (!value || typeof value !== 'object') return new Map();
  if (value instanceof Map) return new Map(value.entries());
  return new Map(Object.entries(value));
}

export class AutoscriptRunner {
  constructor(script, options = {}) {
    this.script = script;
    this.profileId = options.profileId || script.profileId || null;
    this.logger = options.log || ((payload) => console.log(JSON.stringify(payload)));
    this.runId = options.runId || createRunId();
    this.state = {
      active: false,
      reason: null,
      startedAt: null,
      stoppedAt: null,
    };

    this.impactEngine = new ImpactEngine();
    this.subscriptionState = new Map();
    this.operationState = new Map();
    this.operationQueue = Promise.resolve();
    this.pendingOperations = new Set();
    this.watchHandle = null;
    this.donePromise = null;
    this.resolveDone = null;
    this.operationScheduleState = new Map();
    this.runtimeContext = {
      vars: {},
      tabPool: null,
      currentTab: null,
    };
    this.lastNavigationAt = 0;
    this.random = typeof options.random === 'function' ? options.random : Math.random;
    this.executeExternalOperation = options.executeExternalOperation === false
      ? null
      : (typeof options.executeExternalOperation === 'function'
        ? options.executeExternalOperation
        : executeAutoscriptAction);
    this.executeMockOperation = typeof options.executeMockOperation === 'function'
      ? options.executeMockOperation
      : null;
    this.skipValidation = options.skipValidation === true;
    this.mockEvents = Array.isArray(options.mockEvents) ? options.mockEvents : null;
    this.mockEventBaseDelayMs = Math.max(0, Number(options.mockEventBaseDelayMs ?? 0) || 0);
    this.stopWhenMockEventsExhausted = options.stopWhenMockEventsExhausted !== false;
    this.forceRunOperationIds = new Set(
      Array.isArray(options.forceRunOperationIds)
        ? options.forceRunOperationIds.map((item) => String(item || '').trim()).filter(Boolean)
        : [],
    );

    for (const subscription of script.subscriptions || []) {
      this.subscriptionState.set(subscription.id, {
        exists: false,
        appearCount: 0,
        lastEventAt: null,
        version: 0,
      });
    }
    for (const operation of script.operations || []) {
      this.operationState.set(operation.id, {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      });
      this.operationScheduleState.set(operation.id, {
        lastScheduledAt: null,
        lastStartedAt: null,
        lastEventAt: null,
        lastTriggerKey: null,
        lastScheduledAppearCount: null,
        lastCompletedAppearCount: null,
      });
    }
    this.applyInitialState(options.initialState || null);
  }

  applyInitialState(initialState) {
    if (!initialState || typeof initialState !== 'object') return;
    const root = initialState.state && typeof initialState.state === 'object'
      ? initialState.state
      : initialState;
    const subState = plainObjectToMap(root.subscriptionState);
    for (const [key, value] of subState.entries()) {
      if (!key) continue;
      if (!value || typeof value !== 'object') continue;
      const prev = this.subscriptionState.get(key) || {};
      this.subscriptionState.set(key, {
        exists: value.exists === true,
        appearCount: Math.max(0, Number(value.appearCount ?? prev.appearCount ?? 0) || 0),
        lastEventAt: value.lastEventAt || prev.lastEventAt || null,
        version: Math.max(0, Number(value.version ?? prev.version ?? 0) || 0),
      });
    }

    const opState = plainObjectToMap(root.operationState);
    for (const [key, value] of opState.entries()) {
      if (!key) continue;
      if (!value || typeof value !== 'object') continue;
      const prev = this.operationState.get(key) || {};
      this.operationState.set(key, {
        status: String(value.status || prev.status || 'pending'),
        runs: Math.max(0, Number(value.runs ?? prev.runs ?? 0) || 0),
        lastError: value.lastError || prev.lastError || null,
        updatedAt: value.updatedAt || prev.updatedAt || null,
        result: value.result ?? prev.result ?? null,
      });
    }

    const scheduleState = plainObjectToMap(root.operationScheduleState);
    for (const [key, value] of scheduleState.entries()) {
      if (!key) continue;
      if (!value || typeof value !== 'object') continue;
      this.operationScheduleState.set(key, {
        lastScheduledAt: value.lastScheduledAt ?? null,
        lastStartedAt: value.lastStartedAt ?? null,
        lastEventAt: value.lastEventAt ?? null,
        lastTriggerKey: value.lastTriggerKey ?? null,
        lastScheduledAppearCount: value.lastScheduledAppearCount ?? null,
        lastCompletedAppearCount: value.lastCompletedAppearCount ?? null,
      });
    }

    if (root.runtimeContext && typeof root.runtimeContext === 'object') {
      this.runtimeContext = {
        ...this.runtimeContext,
        ...root.runtimeContext,
        vars: root.runtimeContext.vars && typeof root.runtimeContext.vars === 'object'
          ? { ...root.runtimeContext.vars }
          : { ...this.runtimeContext.vars },
      };
    }
    if (Number.isFinite(Number(root.lastNavigationAt))) {
      this.lastNavigationAt = Number(root.lastNavigationAt);
    }
  }

  createSnapshot(reason = 'runtime_snapshot') {
    return {
      kind: 'autoscript_snapshot',
      version: 1,
      reason,
      createdAt: nowIso(),
      runId: this.runId,
      profileId: this.profileId,
      scriptName: this.script?.name || null,
      state: {
        state: this.state,
        subscriptionState: mapToPlainObject(this.subscriptionState),
        operationState: mapToPlainObject(this.operationState),
        operationScheduleState: mapToPlainObject(this.operationScheduleState),
        runtimeContext: this.runtimeContext,
        lastNavigationAt: this.lastNavigationAt,
      },
    };
  }

  log(event, payload = {}) {
    this.logger({
      runId: this.runId,
      profileId: this.profileId,
      event,
      ts: nowIso(),
      ...payload,
    });
  }

  isDependencySatisfied(operation) {
    const deps = operation.dependsOn || [];
    for (const dep of deps) {
      const depState = this.operationState.get(dep);
      if (depState?.status !== 'done' && depState?.status !== 'skipped') return false;
    }
    return true;
  }

  isConditionSatisfied(condition) {
    if (condition.type === 'operation_done') {
      return this.operationState.get(condition.operationId)?.status === 'done';
    }
    if (condition.type === 'subscription_exist') {
      return this.subscriptionState.get(condition.subscriptionId)?.exists === true;
    }
    if (condition.type === 'subscription_appear') {
      return Number(this.subscriptionState.get(condition.subscriptionId)?.appearCount || 0) > 0;
    }
    return false;
  }

  areConditionsSatisfied(operation) {
    for (const condition of operation.conditions || []) {
      if (!this.isConditionSatisfied(condition)) return false;
    }
    return true;
  }

  isTriggered(operation, event) {
    const trigger = operation.trigger || { type: 'startup' };
    if (trigger.type === 'startup') return event.type === 'startup';
    if (trigger.type === 'manual') return event.type === 'manual';
    if (trigger.type !== 'subscription_event') return false;
    return (
      event.subscriptionId === trigger.subscriptionId
      && event.type === trigger.event
    );
  }

  isTriggerStillValid(operation) {
    const trigger = operation?.trigger || { type: 'startup' };
    if (trigger.type !== 'subscription_event') return true;
    const state = this.subscriptionState.get(trigger.subscriptionId);
    const exists = state?.exists === true;
    if (trigger.event === 'exist' || trigger.event === 'appear') {
      return exists;
    }
    if (trigger.event === 'disappear') {
      return !exists;
    }
    return true;
  }

  shouldTreatAsStaleValidationSkip(operation, result) {
    if (!operation || !result || result.ok) return false;
    const phase = String(result?.data?.phase || '').trim().toLowerCase();
    if (phase !== 'pre') return false;
    const code = String(result?.code || '').toUpperCase();
    if (!code.includes('VALIDATION')) return false;
    return !this.isTriggerStillValid(operation);
  }

  resolvePacing(operation) {
    const scriptPacing = this.script?.defaults?.pacing || {};
    const opPacing = operation?.pacing || {};
    const timeoutRaw = operation?.timeoutMs ?? opPacing.timeoutMs ?? this.script?.defaults?.timeoutMs ?? scriptPacing.timeoutMs;
    return {
      operationMinIntervalMs: Math.max(0, Number(opPacing.operationMinIntervalMs ?? scriptPacing.operationMinIntervalMs ?? 0) || 0),
      eventCooldownMs: Math.max(0, Number(opPacing.eventCooldownMs ?? scriptPacing.eventCooldownMs ?? 0) || 0),
      jitterMs: Math.max(0, Number(opPacing.jitterMs ?? scriptPacing.jitterMs ?? 0) || 0),
      navigationMinIntervalMs: Math.max(0, Number(opPacing.navigationMinIntervalMs ?? scriptPacing.navigationMinIntervalMs ?? 0) || 0),
      timeoutMs: timeoutRaw === null || timeoutRaw === undefined ? null : Math.max(0, Number(timeoutRaw) || 0),
    };
  }

  isNavigationAction(action) {
    const normalized = String(action || '').trim().toLowerCase();
    return [
      'goto',
      'back',
      'new_page',
      'switch_page',
      'ensure_tab_pool',
      'tab_pool_switch_next',
      'tab_pool_switch_slot',
    ].includes(normalized);
  }

  getDefaultTimeoutMs(operation) {
    const action = String(operation?.action || '').trim().toLowerCase();
    if (action === 'wait') {
      const ms = Math.max(0, Number(operation?.params?.ms ?? operation?.params?.value ?? 0) || 0);
      return Math.max(30_000, ms + 5_000);
    }
    if ([
      'evaluate',
      'goto',
      'new_page',
      'switch_page',
      'ensure_tab_pool',
      'tab_pool_switch_next',
      'tab_pool_switch_slot',
      'sync_window_viewport',
      'verify_subscriptions',
      'xhs_submit_search',
      'xhs_open_detail',
      'xhs_detail_harvest',
      'xhs_expand_replies',
      'xhs_comments_harvest',
      'xhs_comment_match',
      'xhs_comment_like',
      'xhs_comment_reply',
      'xhs_close_detail',
    ].includes(action)) {
      return 45_000;
    }
    if (['click', 'type', 'back', 'scroll_into_view', 'scroll', 'press_key', 'get_current_url', 'raise_error'].includes(action)) {
      return 30_000;
    }
    return 20_000;
  }

  resolveTimeoutMs(operation) {
    const pacing = this.resolvePacing(operation);
    if (Number.isFinite(pacing.timeoutMs) && pacing.timeoutMs > 0) return pacing.timeoutMs;
    return this.getDefaultTimeoutMs(operation);
  }

  buildTriggerKey(operation, event) {
    const trigger = operation?.trigger || { type: 'startup' };
    if (trigger.type === 'startup') return 'startup';
    if (trigger.type === 'manual') {
      return `manual:${event?.timestamp || event?.type || 'event'}`;
    }
    if (trigger.type !== 'subscription_event') {
      return `${trigger.type || 'unknown'}:${event?.timestamp || event?.type || 'event'}`;
    }

    const subState = this.subscriptionState.get(trigger.subscriptionId);
    if (trigger.event === 'exist') {
      return `${trigger.subscriptionId}:exist:a${Number(subState?.appearCount || 0)}`;
    }
    if (trigger.event === 'appear') {
      return `${trigger.subscriptionId}:appear:n${Number(subState?.appearCount || 0)}`;
    }
    return `${trigger.subscriptionId}:${trigger.event}:v${Number(subState?.version || 0)}`;
  }

  getTriggerAppearCount(operation) {
    const trigger = operation?.trigger || {};
    if (trigger.type !== 'subscription_event') return null;
    if (!trigger.subscriptionId) return null;
    const subState = this.subscriptionState.get(trigger.subscriptionId) || null;
    const appearCount = Number(subState?.appearCount || 0);
    if (!Number.isFinite(appearCount) || appearCount <= 0) return null;
    return appearCount;
  }

  shouldSchedule(operation, event) {
    const forceRun = this.forceRunOperationIds.has(operation.id);
    if (!operation.enabled) return false;
    if (!forceRun && !this.isTriggered(operation, event)) return false;
    if (operation.once && this.operationState.get(operation.id)?.status === 'done') return false;
    if (!this.isDependencySatisfied(operation)) return false;
    if (!this.areConditionsSatisfied(operation)) return false;
    if (!this.impactEngine.canRunOperation(operation, event)) return false;
    if (this.pendingOperations.has(operation.id)) return false;

    const scheduleState = this.operationScheduleState.get(operation.id) || {};
    const pacing = this.resolvePacing(operation);
    const now = Date.now();
    const appearCount = this.getTriggerAppearCount(operation);

    if (pacing.operationMinIntervalMs > 0 && scheduleState.lastStartedAt) {
      if ((now - scheduleState.lastStartedAt) < pacing.operationMinIntervalMs) return false;
    }

    if (pacing.eventCooldownMs > 0 && scheduleState.lastEventAt) {
      if ((now - scheduleState.lastEventAt) < pacing.eventCooldownMs) return false;
    }

    if (
      operation?.oncePerAppear === true
      && Number.isFinite(appearCount)
      && appearCount > 0
      && (
        Number(scheduleState.lastScheduledAppearCount || 0) === appearCount
        || Number(scheduleState.lastCompletedAppearCount || 0) === appearCount
      )
    ) {
      return false;
    }

    const triggerKey = forceRun ? `force:${operation.id}` : this.buildTriggerKey(operation, event);
    const trigger = operation?.trigger || {};
    const allowExistReschedule = trigger?.type === 'subscription_event'
      && trigger?.event === 'exist'
      && operation?.once === false
      && operation?.oncePerAppear !== true
      && (pacing.operationMinIntervalMs > 0 || pacing.eventCooldownMs > 0);
    if (!forceRun && !allowExistReschedule && triggerKey && scheduleState.lastTriggerKey === triggerKey) {
      return false;
    }
    return true;
  }

  resetCycleOperationsForSubscription(subscriptionId) {
    if (!subscriptionId) return;
    for (const operation of this.script.operations || []) {
      if (operation?.oncePerAppear !== true) continue;
      const trigger = operation?.trigger || {};
      if (trigger.type !== 'subscription_event') continue;
      if (trigger.subscriptionId !== subscriptionId) continue;

      const prevState = this.operationState.get(operation.id);
      if (!prevState || prevState.status === 'pending') continue;
      this.operationState.set(operation.id, {
        ...prevState,
        status: 'pending',
        lastError: null,
        result: null,
        updatedAt: nowIso(),
      });
    }
  }

  scheduleReadyOperations(event) {
    for (const operation of this.script.operations || []) {
      if (!this.shouldSchedule(operation, event)) continue;
      this.enqueueOperation(operation, event);
    }
  }

  async runValidation(operation, phase, context) {
    if (this.skipValidation) {
      return {
        ok: true,
        code: 'VALIDATION_SKIPPED',
        message: 'validation skipped in mock/resume mode',
        data: { phase },
      };
    }
    const validation = operation.validation || {};
    return validateOperation({
      profileId: this.profileId,
      validationSpec: validation,
      phase,
      context,
      platform: 'xiaohongshu',
    });
  }

  async executeOnce(operation, context) {
    if (this.executeMockOperation) {
      const mocked = await this.executeMockOperation({
        operation,
        context,
        profileId: this.profileId,
      });
      if (mocked !== undefined) {
        return normalizeExecutionResult(mocked);
      }
    }

    const pre = await this.runValidation(operation, 'pre', context);
    if (!pre.ok) {
      return { ok: false, code: pre.code || 'VALIDATION_FAILED', message: pre.message || 'pre validation failed', data: { phase: 'pre', detail: pre } };
    }

    const execution = await executeOperation({
      profileId: this.profileId,
      operation,
      context: {
        ...context,
        executeExternalOperation: this.executeExternalOperation,
      },
    });
    if (!execution.ok) {
      return { ok: false, code: execution.code || 'OPERATION_FAILED', message: execution.message || 'operation failed', data: { phase: 'execute', detail: execution } };
    }

    const post = await this.runValidation(operation, 'post', context);
    if (!post.ok) {
      return { ok: false, code: post.code || 'VALIDATION_FAILED', message: post.message || 'post validation failed', data: { phase: 'post', detail: post } };
    }

    return { ok: true, code: 'OPERATION_DONE', message: 'operation done', data: execution.data || execution };
  }

  async applyPacingBeforeAttempt(operation, attempt) {
    const pacing = this.resolvePacing(operation);
    if (this.isNavigationAction(operation?.action) && pacing.navigationMinIntervalMs > 0 && this.lastNavigationAt > 0) {
      const elapsed = Date.now() - this.lastNavigationAt;
      if (elapsed < pacing.navigationMinIntervalMs) {
        const waitMs = pacing.navigationMinIntervalMs - elapsed;
        if (waitMs > 0) {
          this.log('autoscript:pacing_wait', {
            operationId: operation.id,
            action: operation.action,
            attempt,
            reason: 'navigation_cooldown',
            waitMs,
          });
          await sleep(waitMs);
        }
      }
    }

    if (pacing.jitterMs > 0) {
      const waitMs = Math.floor(this.random() * (pacing.jitterMs + 1));
      if (waitMs > 0) {
        this.log('autoscript:pacing_wait', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          reason: 'jitter',
          waitMs,
        });
        await sleep(waitMs);
      }
    }
  }

  async runRecovery(operation, event, failure) {
    const checkpoint = operation.checkpoint || {};
    const recovery = checkpoint.recovery || {};
    const actions = Array.isArray(recovery.actions) ? recovery.actions : [];
    const attempts = Math.max(0, Number(recovery.attempts) || 0);
    if (attempts <= 0 || actions.length === 0) {
      return { ok: false, code: 'RECOVERY_NOT_CONFIGURED', message: 'recovery not configured' };
    }

    const checkpointDoc = await captureCheckpoint({
      profileId: this.profileId,
      containerId: checkpoint.containerId || null,
      selector: operation.params?.selector || null,
      platform: 'xiaohongshu',
    });
    const baseCheckpoint = checkpointDoc?.data || {};

    for (let i = 1; i <= attempts; i += 1) {
      let allActionOk = true;
      for (const action of actions) {
        const restored = await restoreCheckpoint({
          profileId: this.profileId,
          checkpoint: baseCheckpoint,
          action,
          containerId: checkpoint.containerId || null,
          selector: operation.params?.selector || null,
          targetCheckpoint: checkpoint.targetCheckpoint || null,
          platform: 'xiaohongshu',
        });
        this.log('autoscript:recovery_action', {
          operationId: operation.id,
          subscriptionId: event.subscriptionId || null,
          action,
          attempt: i,
          ok: restored.ok,
          code: restored.code || null,
          message: restored.message || null,
        });
        if (!restored.ok) {
          allActionOk = false;
        }
      }
      if (allActionOk) {
        return { ok: true, code: 'RECOVERY_DONE', message: 'recovery done', data: { attempts: i } };
      }
    }

    return {
      ok: false,
      code: 'RECOVERY_EXHAUSTED',
      message: 'recovery attempts exhausted',
      data: { operationId: operation.id, failure },
    };
  }

  async runOperation(operation, event) {
    const retry = operation.retry || {};
    const maxAttempts = Math.max(1, Number(retry.attempts) || 1);
    const backoffMs = Math.max(0, Number(retry.backoffMs) || 0);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const context = {
        runId: this.runId,
        event,
        attempt,
        maxAttempts,
        runtime: this.runtimeContext,
      };

      await this.applyPacingBeforeAttempt(operation, attempt);

      if (!this.isTriggerStillValid(operation)) {
        const trigger = operation?.trigger || {};
        const subState = this.subscriptionState.get(trigger.subscriptionId) || null;
        this.operationState.set(operation.id, {
          status: 'skipped',
          runs: Number(this.operationState.get(operation.id)?.runs || 0) + 1,
          lastError: null,
          updatedAt: nowIso(),
          result: {
            code: 'OPERATION_SKIPPED_STALE_TRIGGER',
            trigger,
            currentSubscriptionState: subState,
          },
        });
        this.log('autoscript:operation_skipped', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          reason: 'stale_trigger',
          trigger,
          currentSubscriptionState: subState,
        });
        return {
          ok: true,
          terminalState: 'skipped_stale',
          result: {
            ok: true,
            code: 'OPERATION_SKIPPED_STALE_TRIGGER',
            message: 'operation skipped because trigger is no longer valid',
            data: {
              trigger,
              currentSubscriptionState: subState,
            },
          },
        };
      }

      this.log('autoscript:operation_start', {
        operationId: operation.id,
        action: operation.action,
        attempt,
        maxAttempts,
        trigger: operation.trigger,
        subscriptionId: event.subscriptionId || null,
      });

      const startedAt = Date.now();
      const timeoutMs = this.resolveTimeoutMs(operation);
      const result = await withTimeout(
        this.executeOnce(operation, context),
        timeoutMs,
        () => ({
          ok: false,
          code: 'OPERATION_TIMEOUT',
          message: `operation timed out after ${timeoutMs}ms`,
          data: { timeoutMs },
        }),
      );
      const latencyMs = Date.now() - startedAt;
      if (result.ok) {
        if (this.isNavigationAction(operation?.action)) {
          this.lastNavigationAt = Date.now();
        }
        this.operationState.set(operation.id, {
          status: 'done',
          runs: Number(this.operationState.get(operation.id)?.runs || 0) + 1,
          lastError: null,
          updatedAt: nowIso(),
          result: result.data || null,
        });
        this.log('autoscript:operation_done', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          latencyMs,
          result: result.data || null,
        });
        // Re-evaluate graph on the same event so dependencies can continue in one trigger chain.
        this.scheduleReadyOperations(event);
        return { ok: true, terminalState: 'done', result };
      }

      if (this.shouldTreatAsStaleValidationSkip(operation, result)) {
        const trigger = operation?.trigger || {};
        const subState = this.subscriptionState.get(trigger.subscriptionId) || null;
        this.operationState.set(operation.id, {
          status: 'skipped',
          runs: Number(this.operationState.get(operation.id)?.runs || 0) + 1,
          lastError: null,
          updatedAt: nowIso(),
          result: {
            code: 'OPERATION_SKIPPED_STALE_TRIGGER_PRE_VALIDATION',
            trigger,
            currentSubscriptionState: subState,
          },
        });
        this.log('autoscript:operation_skipped', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          reason: 'stale_trigger_pre_validation',
          trigger,
          currentSubscriptionState: subState,
          validation: result.data?.detail || null,
        });
        return {
          ok: true,
          terminalState: 'skipped_stale_pre_validation',
          result: {
            ok: true,
            code: 'OPERATION_SKIPPED_STALE_TRIGGER_PRE_VALIDATION',
            message: 'operation skipped after pre-validation because trigger is no longer valid',
            data: {
              trigger,
              currentSubscriptionState: subState,
            },
          },
        };
      }

      const terminalDoneCode = extractTerminalDoneCode(result);
      if (terminalDoneCode) {
        this.operationState.set(operation.id, {
          status: 'done',
          runs: Number(this.operationState.get(operation.id)?.runs || 0) + 1,
          lastError: null,
          updatedAt: nowIso(),
          result: { terminalDoneCode },
        });
        this.log('autoscript:operation_terminal', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          latencyMs,
          code: terminalDoneCode,
        });
        this.stop('script_complete');
        return {
          ok: true,
          terminalState: 'done_terminal',
          result: {
            ok: true,
            code: terminalDoneCode,
            message: 'autoscript completed',
            data: { terminalDoneCode },
          },
        };
      }

      this.operationState.set(operation.id, {
        status: 'failed',
        runs: Number(this.operationState.get(operation.id)?.runs || 0) + 1,
        lastError: result.message || 'operation failed',
        updatedAt: nowIso(),
        result: null,
      });
      this.log('autoscript:operation_error', {
        operationId: operation.id,
        action: operation.action,
        attempt,
        latencyMs,
        code: result.code || 'OPERATION_FAILED',
        message: result.message || 'operation failed',
      });

      const recoveryResult = await this.runRecovery(operation, event, result);
      if (recoveryResult.ok) {
        this.log('autoscript:operation_recovered', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          code: recoveryResult.code,
        });
      } else {
        this.log('autoscript:operation_recovery_failed', {
          operationId: operation.id,
          action: operation.action,
          attempt,
          code: recoveryResult.code,
          message: recoveryResult.message,
        });
      }

      if (attempt < maxAttempts) {
        if (backoffMs > 0) await sleep(backoffMs);
        continue;
      }

      const impact = this.impactEngine.applyFailure({ operation, event });
      this.log('autoscript:impact', {
        operationId: operation.id,
        action: operation.action,
        scope: impact.scope,
        scriptStopped: impact.scriptStopped,
        blockedSubscriptions: impact.blockedSubscriptions,
        blockedOperations: impact.blockedOperations,
      });

      if (impact.scriptStopped) {
        this.stop('script_failure');
      }
      return { ok: false, terminalState: 'failed', result };
    }

    return { ok: false, terminalState: 'failed', result: null };
  }

  enqueueOperation(operation, event) {
    if (this.pendingOperations.has(operation.id)) return;
    if (!this.state.active) return;

    const scheduleState = this.operationScheduleState.get(operation.id) || {};
    scheduleState.lastScheduledAt = Date.now();
    scheduleState.lastEventAt = Date.now();
    scheduleState.lastTriggerKey = this.buildTriggerKey(operation, event);
    const scheduledAppearCount = this.getTriggerAppearCount(operation);
    if (Number.isFinite(scheduledAppearCount) && scheduledAppearCount > 0) {
      scheduleState.lastScheduledAppearCount = scheduledAppearCount;
    }
    this.operationScheduleState.set(operation.id, scheduleState);
    this.forceRunOperationIds.delete(operation.id);

    this.pendingOperations.add(operation.id);
    this.operationQueue = this.operationQueue
      .then(async () => {
        if (!this.state.active) return;
        const innerState = this.operationScheduleState.get(operation.id) || {};
        innerState.lastStartedAt = Date.now();
        this.operationScheduleState.set(operation.id, innerState);
        const outcome = await this.runOperation(operation, event);
        if (
          outcome
          && operation?.oncePerAppear === true
          && Number.isFinite(scheduledAppearCount)
          && scheduledAppearCount > 0
          && outcome.terminalState !== 'skipped_stale'
          && outcome.terminalState !== 'skipped_stale_pre_validation'
        ) {
          const completedState = this.operationScheduleState.get(operation.id) || {};
          completedState.lastCompletedAppearCount = scheduledAppearCount;
          this.operationScheduleState.set(operation.id, completedState);
        }
      })
      .finally(() => {
        this.pendingOperations.delete(operation.id);
      });
  }

  async handleEvent(event) {
    if (!this.state.active) return;
    if (event.subscriptionId) {
      const prev = this.subscriptionState.get(event.subscriptionId) || { exists: false, appearCount: 0, lastEventAt: null };
      const next = { ...prev, lastEventAt: event.timestamp || nowIso() };
      if (event.type === 'appear') {
        next.exists = true;
        next.appearCount = Number(prev.appearCount || 0) + 1;
        next.version = Number(prev.version || 0) + 1;
        this.resetCycleOperationsForSubscription(event.subscriptionId);
      } else if (event.type === 'disappear') {
        next.exists = false;
        next.version = Number(prev.version || 0) + 1;
      } else if (event.type === 'exist') {
        next.exists = true;
      } else if (event.type === 'change') {
        next.exists = Number(event.count || 0) > 0 || prev.exists === true;
        next.version = Number(prev.version || 0) + 1;
      }
      this.subscriptionState.set(event.subscriptionId, next);
    }

    this.scheduleReadyOperations(event);
  }

  async start() {
    if (this.state.active) {
      throw new Error('Autoscript runtime already running');
    }
    if (!this.profileId) {
      throw new Error('profileId is required');
    }
    this.state.active = true;
    this.state.reason = null;
    this.state.startedAt = nowIso();
    this.donePromise = new Promise((resolve) => {
      this.resolveDone = resolve;
    });

    this.log('autoscript:start', {
      name: this.script.name,
      subscriptions: this.script.subscriptions.length,
      operations: this.script.operations.length,
      throttle: this.script.throttle,
    });

    if (this.mockEvents) {
      this.watchHandle = { stop: () => {} };
      const events = this.mockEvents.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const type = String(item.type || '').trim();
        if (!type) return null;
        return {
          type,
          subscriptionId: item.subscriptionId ? String(item.subscriptionId) : null,
          selector: item.selector ? String(item.selector) : null,
          count: item.count ?? null,
          timestamp: item.timestamp || nowIso(),
          delayMs: Math.max(0, Number(item.delayMs ?? this.mockEventBaseDelayMs) || this.mockEventBaseDelayMs),
        };
      }).filter(Boolean);

      (async () => {
        for (const event of events) {
          if (!this.state.active) return;
          if (event.delayMs > 0) await sleep(event.delayMs);
          this.log('autoscript:event', {
            type: event.type,
            subscriptionId: event.subscriptionId || null,
            selector: event.selector || null,
            count: event.count ?? null,
          });
          await this.handleEvent(event);
        }
        if (this.stopWhenMockEventsExhausted && this.state.active) {
          // Allow startup-trigger scheduling to enqueue operations before drain check.
          await Promise.resolve();
          await this.operationQueue;
          if (this.state.active) this.stop('mock_events_exhausted');
        }
      })().catch((err) => {
        this.log('autoscript:watch_error', {
          code: 'MOCK_EVENT_FEED_FAILED',
          message: err?.message || String(err),
        });
        if (this.state.active) this.stop('mock_event_feed_failure');
      });
    } else {
      this.watchHandle = await watchSubscriptions({
        profileId: this.profileId,
        subscriptions: this.script.subscriptions,
        throttle: this.script.throttle,
        onEvent: async (event) => {
          this.log('autoscript:event', {
            type: event.type,
            subscriptionId: event.subscriptionId || null,
            selector: event.selector || null,
            count: event.count ?? null,
          });
          await this.handleEvent(event);
        },
        onError: (err) => {
          this.log('autoscript:watch_error', {
            code: 'SUBSCRIPTION_WATCH_FAILED',
            message: err?.message || String(err),
          });
        },
      });
    }

    await this.handleEvent({ type: 'startup', timestamp: nowIso() });
    return {
      runId: this.runId,
      stop: (reason = 'stopped') => this.stop(reason),
      done: this.donePromise,
    };
  }

  stop(reason = 'stopped') {
    if (!this.state.active) return;
    this.state.active = false;
    this.state.reason = reason;
    this.state.stoppedAt = nowIso();
    if (this.watchHandle?.stop) this.watchHandle.stop();
    this.log('autoscript:stop', { reason });
    if (this.resolveDone) {
      this.resolveDone({
        runId: this.runId,
        reason,
        startedAt: this.state.startedAt,
        stoppedAt: this.state.stoppedAt,
      });
      this.resolveDone = null;
    }
  }
}
