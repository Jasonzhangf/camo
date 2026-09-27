// Compiled DAG runner for camo. Entering the page layer is gated on
// `dagpipe graph validate` passing; E_GRAPH_INVALID is returned before any
// profile lock or node handler runs.
//
// Execution walk is static: nodes run in deterministic waves, values flow only
// through declared ARC ids, and operators cannot mutate the graph or select the
// next node.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { lookupNodeRef } from '../page_runtime/snapshot_registry.mjs';

let _profileQueues = new Map();

export function __resetForTest() {
  _profileQueues = new Map();
}

function readGraphFile(graphPath) {
  let raw;
  try {
    raw = fs.readFileSync(graphPath, 'utf8');
  } catch (cause) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'graphPath', reason: cause?.message || String(cause) }, cause });
  }
  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new CamoError({ code: 'E_GRAPH_INVALID', details: { field: 'graphPath', graphPath, reason: 'invalid JSON', error: cause?.message || String(cause) }, cause });
  }
}

export function validateGraph(graphPath) {
  try {
    const result = spawnSync('dagpipe', ['graph', 'validate', graphPath], { encoding: 'utf8' });
    const ok = !result.error && result.status === 0;
    const output = (result.stdout || '').trim();
    const error = (result.stderr || '').trim();
    if (!ok) {
      throw new CamoError({
        code: 'E_GRAPH_INVALID',
        details: { graphPath, reason: error || result.error?.message || 'dagpipe graph validate failed', output },
        cause: result.error || null,
      });
    }
    return output;
  } catch (cause) {
    if (cause instanceof CamoError) throw cause;
    throw new CamoError({
      code: 'E_GRAPH_INVALID',
      details: { graphPath, reason: cause?.message || String(cause) },
      cause,
    });
  }
}

export function compileGraph(graphPath) {
  const graph = readGraphFile(graphPath);
  const ids = new Set();
  const outputOwners = new Map();
  for (const node of graph.nodes || []) {
    if (!node.id || !node.operator || !node.operator_version) {
      throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, node: node?.id, reason: 'node missing id/operator/operator_version' } });
    }
    if (!node.output || typeof node.output.id !== 'string' || node.output.id.length === 0) {
      throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, node: node.id, reason: 'node.output.id must be a non-empty string' } });
    }
    if (ids.has(node.id)) {
      throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, node: node.id, reason: 'duplicate node id' } });
    }
    ids.add(node.id);
    if (outputOwners.has(node.output?.id)) {
      throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, arc: node.output?.id, reason: 'duplicate arc producer' } });
    }
    outputOwners.set(node.output?.id, node.id);
  }
  if (graph.inputs?.length !== 1 || graph.outputs?.length !== 1) {
    throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, reason: 'graph must be SESE: one input ARC and one output ARC' } });
  }
  const indegree = new Map((graph.nodes || []).map((n) => [n.id, 0]));
  const adjacency = new Map((graph.nodes || []).map((n) => [n.id, []]));
  for (const edge of graph.edges || []) {
    if (!indegree.has(edge.to) || !adjacency.has(edge.from)) {
      throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, edge, reason: 'edge references unknown node' } });
    }
    adjacency.get(edge.from).push({ to: edge.to, arcId: edge.arc_id });
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const queue = (graph.nodes || [])
    .filter((n) => indegree.get(n.id) === 0)
    .map((n) => n.id);
  const plan = [];
  while (queue.length > 0) {
    const id = queue.shift();
    plan.push(id);
    for (const next of adjacency.get(id) || []) {
      indegree.set(next.to, indegree.get(next.to) - 1);
      if (indegree.get(next.to) === 0) queue.push(next.to);
    }
  }
  if (plan.length !== (graph.nodes || []).length) {
    throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, reason: 'graph is not acyclic' } });
  }
  return { graph, plan };
}

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(0, Math.round(Math.random() * n));
}

async function applyNodeConfig(node) {
  const cfg = node.config || {};
  const pacing = Number(cfg.pacingMs) || 0;
  const jitter = jitterMs(cfg.jitterMs);
  await sleep(pacing + jitter);
}

async function applyNodePolicy(hook, { node, options, input, request, profileId, output }) {
  const cfg = node.config || {};
  if (!cfg[hook]) return;
  const fn = options?.[hook];
  if (typeof fn !== 'function') {
    throw new CamoError({
      code: 'E_NODE_POLICY_MISSING',
      details: {
        node: node.id,
        hook,
        reason: `node config requires ${hook} but no options.${hook} hook was provided`,
      },
    });
  }
  try {
    const result = await fn({ node, input, request, profileId, output });
    if (hook === 'riskCheckpoint' && result === false) {
      throw new CamoError({ code: 'E_RISK_BLOCKED', details: { node: node.id, hook } });
    }
  } catch (cause) {
    // Preserve already classified failures (including caller-owned login checks).
    if (hook !== 'riskCheckpoint' || cause instanceof CamoError && cause.terminal) throw cause;
    throw new CamoError({
      code: 'E_RISK_BLOCKED',
      details: { node: node.id, hook, reason: cause?.message || String(cause) },
      cause,
    });
  }
}

async function defaultStartSession({ request, profileId }) {
  if (request?.target) {
    return { profileId, target: request.target };
  }
  const { startSession } = await import('../browser_service/bootstrap.mjs');
  const session = await startSession({ profileId });
  return { profileId: session.profileId, target: session.target, sessionId: session.sessionId };
}

async function defaultResolvePageContext({ input }) {
  const { resolveTarget } = await import('../browser_service/bootstrap.mjs');
  const sessionContext = input.session_context || {};
  return resolveTarget({ target: sessionContext.target || null, profileId: sessionContext.profileId });
}

async function defaultCaptureSnapshot({ profileId, input }) {
  const snapshot = await import('../page_runtime/input_pipeline.mjs');
  const pageContext = input.page_context;
  const result = await snapshot.snapshot({ profileId, target: pageContext, rawDom: false });
  // The node's single output ARC must carry everything later nodes need.
  // `semantic_snapshot` therefore keeps the resolved target handle alongside
  // the semantic tree so `validate_visibility_role` can stay single-input.
  return { ...result, target: pageContext };
}

async function defaultValidateVisibilityRole({ input, request, node }) {
  const semantic = input.semantic_snapshot;
  const target = semantic?.target || input.page_context;
  if (!target?.page) {
    throw new CamoError({
      code: 'E_GRAPH_INVALID',
      details: { graphNode: node?.id, reason: 'semantic_snapshot ARC must carry the resolved browser target' },
    });
  }
  const action = request?.action || {};
  const nodeCfg = node.config || {};
  const ref = action.ref || nodeCfg.ref;
  if (ref) {
    const hit = lookupNodeRef(ref, { profileId: semantic.profileId, documentId: semantic.documentId });
    assertUniqueStableLocator(hit.node, semantic.tree?.nodes);
    if (hit.node.visible !== true || hit.node.inViewport !== true) {
      throw new CamoError({
        code: 'E_STATE_INVALID',
        details: { resource: 'semantic_node', ref, reason: 'target must be visible and in the viewport' },
      });
    }
    return { ...semantic, target, validated: hit.node };
  }
  const query = {
    role: action.role ?? nodeCfg.role ?? null,
    text: action.text ?? nodeCfg.text ?? null,
    id: action.id ?? nodeCfg.id ?? null,
  };
  if (!query.role && !query.text && !query.id) {
    throw new CamoError({ code: 'E_SNAPSHOT_REF_INVALID', details: { reason: 'validate_visibility_role requires ref or role/text/id query' } });
  }
  const matcher = await import('../container/matcher.mjs');
  const visibleNodes = semantic.tree.nodes.filter((candidate) => candidate.visible === true && candidate.inViewport === true);
  const match = matcher.match(query, visibleNodes);
  const primary = match?.primary;
  if (!primary) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'semantic_node', query: match?.query } });
  }
  assertUniqueStableLocator(primary, semantic.tree?.nodes);
  return { ...semantic, target, validated: primary };
}

function assertUniqueStableLocator(validated, nodes) {
  if (!validated || typeof validated !== 'object') return;
  if (typeof validated.stableLocator !== 'string' || validated.stableLocator.length === 0) return;
  if (!Array.isArray(nodes) || nodes.length === 0) return;
  const sameLocatorCount = nodes.filter((candidate) => typeof candidate?.stableLocator === 'string'
    && candidate.stableLocator === validated.stableLocator).length;
  if (sameLocatorCount > 1) {
    throw new CamoError({
      code: 'E_SNAPSHOT_AMBIGUOUS',
      details: {
        resource: 'semantic_node',
        ref: validated.ref || null,
        stableLocator: validated.stableLocator,
        reason: 'stableLocator matches multiple snapshot nodes; cannot turn it into a unique action target',
      },
    });
  }
}

function nodeText(node) {
  if (!node || typeof node !== 'object') return null;
  if (typeof node.nameText === 'string' && node.nameText.length > 0) return node.nameText;
  if (typeof node.name === 'string' && node.name.length > 0) return node.name;
  return null;
}

function assertUniqueText(validated, nodes, text) {
  if (!text || !Array.isArray(nodes) || nodes.length === 0) return;
  const sameTextCount = nodes.filter((candidate) => nodeText(candidate) === text).length;
  if (sameTextCount > 1) {
    throw new CamoError({
      code: 'E_SNAPSHOT_AMBIGUOUS',
      details: {
        resource: 'semantic_node',
        ref: validated.ref || null,
        text,
        reason: 'text matches multiple snapshot nodes; cannot turn it into a unique action target',
      },
    });
  }
}

function validatedLocator(validated, semanticNodes) {
  if (!validated || typeof validated !== 'object') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'validated_target.validated', reason: 'execute_input_pipeline requires a validated target node' } });
  }
  assertUniqueStableLocator(validated, semanticNodes);
  if (typeof validated.stableLocator === 'string' && validated.stableLocator.length > 0) {
    return { selector: validated.stableLocator };
  }
  const text = nodeText(validated);
  assertUniqueText(validated, semanticNodes, text);
  if (text) return { text };
  if (validated.ref) {
    throw new CamoError({
      code: 'E_SNAPSHOT_REF_INVALID',
      details: { ref: validated.ref, reason: 'validated node has no stableLocator or nameText to map into an action locator' },
    });
  }
  throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'validated_target.validated.stableLocator/nameText', reason: 'validated node has no locator fields' } });
}

function locatorParams(params, locator) {
  const merged = { ...(params || {}) };
  if (locator.selector != null) {
    merged.selector = locator.selector;
    delete merged.text;
  } else if (locator.text != null) {
    merged.text = locator.text;
    delete merged.selector;
  }
  return merged;
}

async function defaultExecuteInputPipeline({ profileId, input, request }) {
  const validated = input.validated_target?.validated;
  if (!validated || typeof validated !== 'object') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'validated_target.validated', reason: 'cannot execute action against an unvalidated target' } });
  }
  const action = { ...request?.action };
  const target = input.validated_target?.target || input.page_context;
  const semanticNodes = input.validated_target?.tree?.nodes;
  if (!action || typeof action.kind !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'action.kind' } });
  }
  const pipeline = await import('../page_runtime/input_pipeline.mjs');
  const kind = action.kind.toLowerCase();
  if (kind === 'click') {
    const locator = validatedLocator(validated, semanticNodes);
    const out = await pipeline.click({ target, profileId, ...locatorParams(action.params, locator) });
    return { ok: true, kind, result: out };
  }
  if (kind === 'type') {
    const locator = validatedLocator(validated, semanticNodes);
    const params = { ...(action.params || {}) };
    const text = String(params.text || '');
    if (!text) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'text' } });
    if (locator.selector != null) {
      const out = await pipeline.type({ target, profileId, text, selector: locator.selector, delay: params.delay });
      return { ok: true, kind, result: out };
    }
    await pipeline.click({ target, profileId, text: locator.text });
    const out = await pipeline.type({ target, profileId, text, delay: params.delay });
    return { ok: true, kind, result: out };
  }
  if (kind === 'scroll') {
    const bounds = validated.bounds && typeof validated.bounds === 'object' ? validated.bounds : null;
    const scrollParams = { target, profileId, ...(action.params || {}) };
    if (bounds && Number.isFinite(bounds.x) && Number.isFinite(bounds.y)
      && Number.isFinite(bounds.width) && Number.isFinite(bounds.height)) {
      scrollParams.atX = Math.round(bounds.x + bounds.width / 2);
      scrollParams.atY = Math.round(bounds.y + bounds.height / 2);
    }
    const out = await pipeline.scroll(scrollParams);
    return { ok: true, kind, result: out };
  }
  throw new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { actionKind: kind } });
}

const defaultHandlers = {
  'camo.start_session': defaultStartSession,
  'camo.resolve_page_context': defaultResolvePageContext,
  'camo.snapshot': defaultCaptureSnapshot,
  'camo.container.validate': defaultValidateVisibilityRole,
  'camo.input.action': defaultExecuteInputPipeline,
};

function runSerial(profileId, task) {
  const previous = _profileQueues.get(profileId) || Promise.resolve();
  const next = previous.then(
    () => task(),
    () => task(),
  );
  _profileQueues.set(profileId, next.catch(() => {}));
  return next;
}

export async function runGraph({ graphPath, profileId, request = {}, handlers = {}, options = {} }) {
  const pid = String(profileId || request?.profileId || 'default');
  const validationOutput = validateGraph(graphPath);
  const { graph, plan } = compileGraph(graphPath);
  const activeHandlers = { ...defaultHandlers, ...handlers };
  return runSerial(pid, async () => {
    await options.beforeExecution?.({ graph, plan, profileId: pid, request });
    const arcs = new Map();
    for (const input of graph.inputs || []) arcs.set(input.id, request);
    for (const nodeId of plan) {
      const node = graph.nodes.find((n) => n.id === nodeId);
      const input = {};
      for (const arcId of node.inputs || []) {
        if (!arcs.has(arcId)) {
          throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphId: graph.id, node: nodeId, arcId, reason: 'missing ARC input' } });
        }
        input[arcId] = arcs.get(arcId);
      }
      await applyNodeConfig(node);
      const policyContext = { node, options, input, request, profileId: pid };
      await applyNodePolicy('preValidation', policyContext);
      await applyNodePolicy('riskCheckpoint', policyContext);
      const handlerKey = `${node.operator}@${node.operator_version}`;
      const handler = activeHandlers[handlerKey] || activeHandlers[node.operator];
      if (typeof handler !== 'function') {
        throw new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { node: nodeId, operator: node.operator, operatorVersion: node.operator_version } });
      }
      const output = await handler({ node, input, request, profileId: pid });
      await applyNodePolicy('postValidation', { ...policyContext, output });
      arcs.set(node.output.id, output);
    }
    const result = arcs.get(graph.outputs[0]);
    return {
      ok: true,
      graphId: graph.id,
      graphVersion: graph.version,
      validation: validationOutput.split('\n')[0],
      plan,
      result,
    };
  });
}
