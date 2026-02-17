import fs from 'node:fs';
import path from 'node:path';

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTrigger(value) {
  if (!value) return { type: 'startup' };
  if (typeof value === 'string') {
    const token = value.trim();
    if (!token) return { type: 'startup' };
    if (token === 'startup' || token === 'manual') return { type: token };
    const [subscriptionId, event] = token.split('.');
    if (subscriptionId && event) {
      return { type: 'subscription_event', subscriptionId: subscriptionId.trim(), event: event.trim() };
    }
    return { type: 'unknown', raw: token };
  }
  if (typeof value !== 'object') return { type: 'startup' };
  if (value.type === 'startup' || value.type === 'manual') return { type: value.type };
  const subscriptionId = toTrimmedString(value.subscriptionId || value.subscription);
  const event = toTrimmedString(value.event);
  if (subscriptionId && event) {
    return { type: 'subscription_event', subscriptionId, event };
  }
  return { type: 'unknown', raw: value };
}

function normalizeCondition(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (text.startsWith('operation_done:')) {
      return { type: 'operation_done', operationId: text.slice('operation_done:'.length).trim() };
    }
    if (text.startsWith('subscription_exist:')) {
      return { type: 'subscription_exist', subscriptionId: text.slice('subscription_exist:'.length).trim() };
    }
    if (text.startsWith('subscription_appear:')) {
      return { type: 'subscription_appear', subscriptionId: text.slice('subscription_appear:'.length).trim() };
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const type = toTrimmedString(value.type);
  if (!type) return null;
  return {
    type,
    operationId: toTrimmedString(value.operationId || value.operation) || null,
    subscriptionId: toTrimmedString(value.subscriptionId || value.subscription) || null,
  };
}

function normalizeRetry(value, defaults = {}) {
  const retry = value && typeof value === 'object' ? value : {};
  const attempts = Math.max(1, Number(retry.attempts ?? defaults.attempts ?? 1) || 1);
  const backoffMs = Math.max(0, Number(retry.backoffMs ?? defaults.backoffMs ?? 0) || 0);
  return { attempts, backoffMs };
}

function normalizeRecovery(value, defaults = {}) {
  const recovery = value && typeof value === 'object' ? value : {};
  const attempts = Math.max(0, Number(recovery.attempts ?? defaults.attempts ?? 0) || 0);
  const actions = toArray(recovery.actions ?? defaults.actions ?? [])
    .map((item) => toTrimmedString(item))
    .filter(Boolean);
  return { attempts, actions };
}

function normalizeValidation(value, defaults = {}) {
  const validation = value && typeof value === 'object' ? value : {};
  const mode = toTrimmedString(validation.mode || defaults.validationMode || 'none') || 'none';
  return {
    mode,
    pre: validation.pre && typeof validation.pre === 'object' ? validation.pre : null,
    post: validation.post && typeof validation.post === 'object' ? validation.post : null,
  };
}

function normalizePacing(value, defaults = {}) {
  const pacing = value && typeof value === 'object' ? value : {};
  const operationMinIntervalMs = Math.max(
    0,
    Number(
      pacing.operationMinIntervalMs
      ?? pacing.minIntervalMs
      ?? defaults.operationMinIntervalMs
      ?? defaults.minIntervalMs
      ?? 0,
    ) || 0,
  );
  const eventCooldownMs = Math.max(
    0,
    Number(pacing.eventCooldownMs ?? defaults.eventCooldownMs ?? 0) || 0,
  );
  const jitterMs = Math.max(
    0,
    Number(pacing.jitterMs ?? defaults.jitterMs ?? 0) || 0,
  );
  const navigationMinIntervalMs = Math.max(
    0,
    Number(pacing.navigationMinIntervalMs ?? defaults.navigationMinIntervalMs ?? 0) || 0,
  );
  const timeoutMsRaw = pacing.timeoutMs ?? defaults.timeoutMs;
  const timeoutMs = timeoutMsRaw === null || timeoutMsRaw === undefined
    ? null
    : Math.max(0, Number(timeoutMsRaw) || 0);

  return {
    operationMinIntervalMs,
    eventCooldownMs,
    jitterMs,
    navigationMinIntervalMs,
    timeoutMs,
  };
}

function normalizeSubscription(item, index, defaults) {
  if (!item || typeof item !== 'object') return null;
  const id = toTrimmedString(item.id) || `subscription_${index + 1}`;
  const selector = toTrimmedString(item.selector);
  if (!selector) return null;
  const events = toArray(item.events).map((name) => toTrimmedString(name)).filter(Boolean);
  return {
    id,
    selector,
    events: events.length > 0 ? events : ['appear', 'exist', 'disappear', 'change'],
    dependsOn: toArray(item.dependsOn).map((x) => toTrimmedString(x)).filter(Boolean),
    retry: normalizeRetry(item.retry, defaults.retry),
    impact: toTrimmedString(item.impact || defaults.impact || 'subscription') || 'subscription',
  };
}

function normalizeOperation(item, index, defaults) {
  if (!item || typeof item !== 'object') return null;
  const id = toTrimmedString(item.id) || `operation_${index + 1}`;
  const action = toTrimmedString(item.action);
  if (!action) return null;
  const params = item.params && typeof item.params === 'object'
    ? { ...item.params }
    : {
      ...(item.selector ? { selector: item.selector } : {}),
      ...(item.url ? { url: item.url } : {}),
      ...(item.text !== undefined ? { text: item.text } : {}),
      ...(item.script !== undefined ? { script: item.script } : {}),
      ...(item.ms !== undefined ? { ms: item.ms } : {}),
      ...(item.value !== undefined ? { value: item.value } : {}),
    };

  return {
    id,
    enabled: item.enabled !== false,
    action,
    params,
    trigger: normalizeTrigger(item.trigger),
    dependsOn: toArray(item.dependsOn).map((x) => toTrimmedString(x)).filter(Boolean),
    conditions: toArray(item.conditions).map(normalizeCondition).filter(Boolean),
    retry: normalizeRetry(item.retry, defaults.retry),
    impact: toTrimmedString(item.impact || defaults.impact || 'op') || 'op',
    onFailure: toTrimmedString(item.onFailure || defaults.onFailure || 'chain_stop') || 'chain_stop',
    pacing: normalizePacing(item.pacing, defaults.pacing || {}),
    timeoutMs: (() => {
      const timeoutRaw = item.timeoutMs ?? defaults.timeoutMs;
      if (timeoutRaw === null || timeoutRaw === undefined || timeoutRaw === '') return null;
      return Math.max(0, Number(timeoutRaw) || 0);
    })(),
    validation: normalizeValidation(item.validate || item.validation, defaults),
    checkpoint: {
      containerId: toTrimmedString(item.checkpoint?.containerId || item.containerId) || null,
      targetCheckpoint: toTrimmedString(item.checkpoint?.targetCheckpoint) || null,
      recovery: normalizeRecovery(item.checkpoint?.recovery, defaults.recovery),
    },
    once: item.once !== false,
    oncePerAppear: item.oncePerAppear === true,
  };
}

function topoSortOperations(operations) {
  const byId = new Map(operations.map((op) => [op.id, op]));
  const temp = new Set();
  const visited = new Set();
  const sorted = [];
  const cycles = [];

  const dfs = (id, trace = []) => {
    if (visited.has(id)) return;
    if (temp.has(id)) {
      const cyclePath = [...trace, id];
      cycles.push(cyclePath);
      return;
    }
    temp.add(id);
    const node = byId.get(id);
    for (const dep of node?.dependsOn || []) {
      if (!byId.has(dep)) continue;
      dfs(dep, [...trace, id]);
    }
    temp.delete(id);
    visited.add(id);
    if (node) sorted.push(node);
  };

  for (const op of operations) dfs(op.id);
  return { sorted, cycles };
}

export function loadAutoscriptFile(filePath) {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Autoscript file not found: ${resolvedPath}`);
  }
  let payload = null;
  try {
    payload = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid autoscript JSON: ${err?.message || String(err)}`);
  }
  return { resolvedPath, payload };
}

export function normalizeAutoscript(raw, sourcePath = null) {
  const defaults = raw?.defaults && typeof raw.defaults === 'object' ? raw.defaults : {};
  const subscriptions = toArray(raw?.subscriptions)
    .map((item, index) => normalizeSubscription(item, index, defaults))
    .filter(Boolean);
  const operations = toArray(raw?.operations)
    .map((item, index) => normalizeOperation(item, index, defaults))
    .filter(Boolean);

  return {
    version: Number(raw?.version || 1),
    sourcePath,
    name: toTrimmedString(raw?.name) || (sourcePath ? path.basename(sourcePath) : 'autoscript'),
    profileId: toTrimmedString(raw?.profileId) || null,
    throttle: Math.max(100, Number(raw?.throttle || 500) || 500),
    defaults: {
      retry: normalizeRetry(defaults.retry, {}),
      impact: toTrimmedString(defaults.impact || 'op') || 'op',
      onFailure: toTrimmedString(defaults.onFailure || 'chain_stop') || 'chain_stop',
      validationMode: toTrimmedString(defaults.validationMode || 'none') || 'none',
      recovery: normalizeRecovery(defaults.recovery, {}),
      pacing: normalizePacing(defaults.pacing, {}),
      timeoutMs: (() => {
        const timeoutRaw = defaults.timeoutMs;
        if (timeoutRaw === null || timeoutRaw === undefined || timeoutRaw === '') return null;
        return Math.max(0, Number(timeoutRaw) || 0);
      })(),
    },
    subscriptions,
    operations,
    raw,
  };
}

export function validateAutoscript(script) {
  const errors = [];
  const warnings = [];
  const subscriptionIds = new Set();
  const operationIds = new Set();

  for (const subscription of script.subscriptions) {
    if (subscriptionIds.has(subscription.id)) {
      errors.push(`duplicate subscription id: ${subscription.id}`);
    }
    subscriptionIds.add(subscription.id);
  }
  for (const operation of script.operations) {
    if (operationIds.has(operation.id)) {
      errors.push(`duplicate operation id: ${operation.id}`);
    }
    operationIds.add(operation.id);
  }

  for (const operation of script.operations) {
    if (operation.trigger?.type === 'subscription_event') {
      if (!subscriptionIds.has(operation.trigger.subscriptionId)) {
        errors.push(`operation ${operation.id}: unknown trigger subscription ${operation.trigger.subscriptionId}`);
      }
    } else if (operation.trigger?.type === 'unknown') {
      errors.push(`operation ${operation.id}: unsupported trigger ${JSON.stringify(operation.trigger.raw)}`);
    }

    for (const dep of operation.dependsOn || []) {
      if (!operationIds.has(dep)) {
        errors.push(`operation ${operation.id}: unknown dependency ${dep}`);
      }
    }

    for (const condition of operation.conditions || []) {
      if (condition.type === 'operation_done' && condition.operationId && !operationIds.has(condition.operationId)) {
        errors.push(`operation ${operation.id}: unknown condition operation ${condition.operationId}`);
      }
      if ((condition.type === 'subscription_exist' || condition.type === 'subscription_appear')
          && condition.subscriptionId && !subscriptionIds.has(condition.subscriptionId)) {
        errors.push(`operation ${operation.id}: unknown condition subscription ${condition.subscriptionId}`);
      }
    }

    if (!operation.enabled) {
      warnings.push(`operation ${operation.id} is disabled`);
    }
  }

  const topo = topoSortOperations(script.operations);
  if (topo.cycles.length > 0) {
    for (const cycle of topo.cycles) {
      errors.push(`operation dependency cycle: ${cycle.join(' -> ')}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: topo.sorted.map((item) => item.id),
  };
}

export function explainAutoscript(script) {
  const validation = validateAutoscript(script);
  const operationMap = Object.fromEntries(
    script.operations.map((operation) => [
      operation.id,
      {
        trigger: operation.trigger,
        dependsOn: operation.dependsOn,
        impact: operation.impact,
        onFailure: operation.onFailure,
        retry: operation.retry,
        pacing: operation.pacing,
        timeoutMs: operation.timeoutMs,
        validation: operation.validation,
        checkpoint: operation.checkpoint,
      },
    ]),
  );

  return {
    ok: validation.ok,
    validation,
    summary: {
      name: script.name,
      version: script.version,
      subscriptions: script.subscriptions.length,
      operations: script.operations.length,
      throttle: script.throttle,
    },
    defaults: script.defaults,
    subscriptionOrder: script.subscriptions.map((item) => item.id),
    operationOrder: validation.topologicalOrder,
    operationMap,
  };
}

export function loadAndValidateAutoscript(filePath) {
  const { resolvedPath, payload } = loadAutoscriptFile(filePath);
  const script = normalizeAutoscript(payload, resolvedPath);
  const validation = validateAutoscript(script);
  return {
    script,
    validation,
    sourcePath: resolvedPath,
  };
}
