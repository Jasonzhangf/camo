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

function compileGraph(graphPath) {
  const graph = readGraphFile(graphPath);
  const ids = new Set();
  const outputOwners = new Map();
  for (const node of graph.nodes || []) {
    if (!node.id || !node.operator || !node.operator_version) {
      throw new CamoError({ code: 'E_GRAPH_INVALID', details: { graphPath, node: node?.id, reason: 'node missing id/operator/operator_version' } });
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
  return snapshot.snapshot({ profileId, target: pageContext, rawDom: false });
}

async function defaultValidateVisibilityRole({ input, request, node }) {
  const semantic = input.semantic_snapshot;
  const target = input.page_context;
  const action = request?.action || {};
  const nodeCfg = node.config || {};
  const ref = action.ref || nodeCfg.ref;
  if (ref) {
    const hit = lookupNodeRef(ref, { profileId: semantic.profileId, documentId: semantic.documentId });
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
  const match = matcher.match(query, semantic.tree.nodes);
  const primary = match?.primary;
  if (!primary) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'semantic_node', query: match?.query } });
  }
  return { ...semantic, target, validated: primary };
}

async function defaultExecuteInputPipeline({ profileId, input, request }) {
  const action = input.validated_target?.validated ? { ...request?.action } : request?.action;
  const target = input.validated_target?.target || input.page_context;
  if (!action || typeof action.kind !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'action.kind' } });
  }
  const pipeline = await import('../page_runtime/input_pipeline.mjs');
  const kind = action.kind.toLowerCase();
  if (kind === 'click') {
    const out = await pipeline.click({ ...target, profileId, ...(action.params || {}) });
    return { ok: true, kind, result: out };
  }
  if (kind === 'type') {
    const out = await pipeline.type({ ...target, profileId, ...(action.params || {}) });
    return { ok: true, kind, result: out };
  }
  if (kind === 'scroll') {
    const out = await pipeline.scroll({ ...target, profileId, ...(action.params || {}) });
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
      const handlerKey = `${node.operator}@${node.operator_version}`;
      const handler = activeHandlers[handlerKey] || activeHandlers[node.operator];
      if (typeof handler !== 'function') {
        throw new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { node: nodeId, operator: node.operator, operatorVersion: node.operator_version } });
      }
      const output = await handler({ node, input, request, profileId: pid });
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
