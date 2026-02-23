import fs from 'node:fs';
import path from 'node:path';
import { getDefaultProfile } from '../utils/config.mjs';
import { explainAutoscript, loadAndValidateAutoscript } from '../autoscript/schema.mjs';
import { AutoscriptRunner } from '../autoscript/runtime.mjs';
import { safeAppendProgressEvent } from '../events/progress-log.mjs';

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function collectPositionals(args, startIndex = 2, valueFlags = new Set(['--profile', '-p'])) {
  const out = [];
  for (let i = startIndex; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (valueFlags.has(arg)) {
      i += 1;
      continue;
    }
    if (String(arg).startsWith('-')) continue;
    out.push(arg);
  }
  return out;
}

function appendJsonLine(filePath, payload) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8');
}

function normalizeResultPayload(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.result && typeof result.result === 'object' && !Array.isArray(result.result)) {
    return result.result;
  }
  return result;
}

function bumpCounter(target, key) {
  if (!target[key]) {
    target[key] = 1;
    return;
  }
  target[key] += 1;
}

function createRunSummaryTracker({ file, profileId, runId }) {
  return {
    file,
    profileId,
    runId,
    runName: null,
    startTs: null,
    stopTs: null,
    stopReason: null,
    counts: {
      operationStart: 0,
      operationDone: 0,
      operationError: 0,
      operationSkipped: 0,
      operationTerminal: 0,
      watchError: 0,
    },
    target: {
      visitedMax: 0,
      notesClosed: 0,
      harvestCount: 0,
      likeOps: 0,
    },
    comments: {
      total: 0,
      expectedTotal: 0,
      bottomReached: 0,
      recoveriesTotal: 0,
      coverageSum: 0,
      coverageCount: 0,
      exitReasonCounts: {},
      commentsPathsCount: 0,
    },
    likes: {
      scanned: 0,
      hit: 0,
      liked: 0,
      dedupSkipped: 0,
      alreadyLikedSkipped: 0,
      verifyFailed: 0,
      clickFailed: 0,
      missingLikeControl: 0,
      summaryCount: 0,
    },
    closeDetail: {
      rollbackTotal: 0,
      returnToSearchTotal: 0,
      searchCountMax: 0,
      pageExitReasonCounts: {},
    },
    terminal: {
      operationId: null,
      code: null,
      ts: null,
    },
  };
}

function applyRunSummaryEvent(tracker, payload) {
  if (!payload || typeof payload !== 'object') return;
  const { event, ts } = payload;
  if (event === 'autoscript:start') {
    tracker.startTs = tracker.startTs || ts || null;
    tracker.runId = tracker.runId || payload.runId || null;
    tracker.profileId = tracker.profileId || payload.profileId || null;
    tracker.runName = payload.name || tracker.runName;
    return;
  }
  if (event === 'autoscript:stop') {
    tracker.stopReason = payload.reason || tracker.stopReason;
    return;
  }
  if (event === 'autoscript:watch_error') {
    tracker.counts.watchError += 1;
    return;
  }
  if (event === 'autoscript:operation_start') {
    tracker.counts.operationStart += 1;
    return;
  }
  if (event === 'autoscript:operation_error') {
    tracker.counts.operationError += 1;
    return;
  }
  if (event === 'autoscript:operation_skipped') {
    tracker.counts.operationSkipped += 1;
    return;
  }
  if (event === 'autoscript:operation_terminal') {
    tracker.counts.operationTerminal += 1;
    tracker.terminal.operationId = payload.operationId || tracker.terminal.operationId;
    tracker.terminal.code = payload.code || tracker.terminal.code;
    tracker.terminal.ts = payload.ts || tracker.terminal.ts;
    return;
  }
  if (event !== 'autoscript:operation_done') return;

  tracker.counts.operationDone += 1;
  const result = normalizeResultPayload(payload.result);
  const opId = payload.operationId;
  if (!opId || !result || typeof result !== 'object') return;

  if (opId === 'open_first_detail' || opId === 'open_next_detail') {
    const visited = Number(result.visited);
    if (Number.isFinite(visited)) {
      tracker.target.visitedMax = Math.max(tracker.target.visitedMax, visited);
    }
    return;
  }

  if (opId === 'comments_harvest') {
    tracker.target.harvestCount += 1;
    tracker.comments.total += Number(result.collected || 0);
    tracker.comments.expectedTotal += Number(result.expectedCommentsCount || 0);
    tracker.comments.recoveriesTotal += Number(result.recoveries || 0);
    if (result.reachedBottom === true) tracker.comments.bottomReached += 1;
    if (result.commentsPath) tracker.comments.commentsPathsCount += 1;
    const coverage = Number(result.commentCoverageRate);
    if (Number.isFinite(coverage)) {
      tracker.comments.coverageCount += 1;
      tracker.comments.coverageSum += coverage;
    }
    bumpCounter(tracker.comments.exitReasonCounts, result.exitReason || 'unknown');
    return;
  }

  if (opId === 'comment_like') {
    tracker.target.likeOps += 1;
    tracker.likes.scanned += Number(result.scannedCount || 0);
    tracker.likes.hit += Number(result.hitCount || 0);
    tracker.likes.liked += Number(result.likedCount || 0);
    tracker.likes.dedupSkipped += Number(result.dedupSkipped || 0);
    tracker.likes.alreadyLikedSkipped += Number(result.alreadyLikedSkipped || 0);
    tracker.likes.verifyFailed += Number(result.verifyFailed || 0);
    tracker.likes.clickFailed += Number(result.clickFailed || 0);
    tracker.likes.missingLikeControl += Number(result.missingLikeControl || 0);
    if (result.summaryPath) tracker.likes.summaryCount += 1;
    return;
  }

  if (opId === 'close_detail') {
    tracker.target.notesClosed += 1;
    tracker.closeDetail.rollbackTotal += Number(result.rollbackCount || 0);
    tracker.closeDetail.returnToSearchTotal += Number(result.returnToSearchCount || 0);
    tracker.closeDetail.searchCountMax = Math.max(
      tracker.closeDetail.searchCountMax,
      Number(result.searchCount || 0),
    );
    bumpCounter(tracker.closeDetail.pageExitReasonCounts, result.pageExitReason || 'unknown');
  }
}

function buildRunSummary(tracker, fallbackStopReason = null) {
  const harvestCount = tracker.target.harvestCount;
  const coverageCount = tracker.comments.coverageCount;
  const durationSec = tracker.startTs && tracker.stopTs
    ? (new Date(tracker.stopTs).getTime() - new Date(tracker.startTs).getTime()) / 1000
    : null;
  return {
    runId: tracker.runId || null,
    profileId: tracker.profileId || null,
    file: tracker.file || null,
    runName: tracker.runName || null,
    startTs: tracker.startTs || null,
    stopTs: tracker.stopTs || null,
    durationSec,
    stopReason: tracker.stopReason || fallbackStopReason || null,
    counts: tracker.counts,
    target: tracker.target,
    comments: {
      total: tracker.comments.total,
      expectedTotal: tracker.comments.expectedTotal,
      avgPerNote: harvestCount > 0 ? tracker.comments.total / harvestCount : null,
      bottomReached: tracker.comments.bottomReached,
      bottomRate: harvestCount > 0 ? tracker.comments.bottomReached / harvestCount : null,
      recoveriesTotal: tracker.comments.recoveriesTotal,
      exitReasonCounts: tracker.comments.exitReasonCounts,
      coverageAvg: coverageCount > 0 ? tracker.comments.coverageSum / coverageCount : null,
      commentsPathsCount: tracker.comments.commentsPathsCount,
    },
    likes: tracker.likes,
    closeDetail: tracker.closeDetail,
    terminal: tracker.terminal.code
      ? tracker.terminal
      : null,
  };
}

function buildDefaultSummaryPath(jsonlPath) {
  if (!jsonlPath) return null;
  return jsonlPath.endsWith('.jsonl')
    ? `${jsonlPath.slice(0, -'.jsonl'.length)}.summary.json`
    : `${jsonlPath}.summary.json`;
}

function readJsonlEvents(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`JSONL file not found: ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const rows = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSONL at line ${index + 1}: ${err?.message || String(err)}`);
      }
    });
  return { resolvedPath: resolved, rows };
}

function cloneObject(value, fallback = {}) {
  if (!value || typeof value !== 'object') return { ...fallback };
  return { ...fallback, ...value };
}

function reduceSubscriptionState(subscriptionState, event) {
  if (!event?.subscriptionId) return;
  const prev = subscriptionState[event.subscriptionId] || {
    exists: false,
    appearCount: 0,
    version: 0,
    lastEventAt: null,
  };
  const next = { ...prev, lastEventAt: event.ts || null };
  if (event.type === 'appear') {
    next.exists = true;
    next.appearCount = Number(prev.appearCount || 0) + 1;
    next.version = Number(prev.version || 0) + 1;
  } else if (event.type === 'exist') {
    next.exists = true;
  } else if (event.type === 'disappear') {
    next.exists = false;
    next.version = Number(prev.version || 0) + 1;
  } else if (event.type === 'change') {
    next.exists = Number(event.count || 0) > 0 || prev.exists === true;
    next.version = Number(prev.version || 0) + 1;
  }
  subscriptionState[event.subscriptionId] = next;
}

function buildSnapshotFromEvents({
  events,
  file,
  reason = 'log_snapshot',
}) {
  const first = events[0] || null;
  const last = events[events.length - 1] || null;
  const tracker = createRunSummaryTracker({
    file,
    profileId: first?.profileId || null,
    runId: first?.runId || null,
  });

  const operationState = {};
  const subscriptionState = {};
  let state = { active: false, reason: null, startedAt: null, stoppedAt: null };
  let lastEvent = null;

  for (const event of events) {
    applyRunSummaryEvent(tracker, event);

    if (event.event === 'autoscript:start') {
      state = {
        active: true,
        reason: null,
        startedAt: event.ts || null,
        stoppedAt: null,
      };
    }

    if (event.event === 'autoscript:event') {
      reduceSubscriptionState(subscriptionState, event);
      lastEvent = {
        type: event.type || 'tick',
        subscriptionId: event.subscriptionId || null,
        selector: event.selector || null,
        count: event.count ?? null,
        timestamp: event.ts || null,
      };
    }

    if (event.event === 'autoscript:operation_start') {
      const prev = cloneObject(operationState[event.operationId], {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      });
      operationState[event.operationId] = {
        ...prev,
        status: 'running',
        updatedAt: event.ts || prev.updatedAt,
      };
    } else if (event.event === 'autoscript:operation_done') {
      const prev = cloneObject(operationState[event.operationId], {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      });
      operationState[event.operationId] = {
        ...prev,
        status: 'done',
        runs: Number(prev.runs || 0) + 1,
        lastError: null,
        updatedAt: event.ts || prev.updatedAt,
        result: event.result ?? null,
      };
    } else if (event.event === 'autoscript:operation_error') {
      const prev = cloneObject(operationState[event.operationId], {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      });
      operationState[event.operationId] = {
        ...prev,
        status: 'failed',
        runs: Number(prev.runs || 0) + 1,
        lastError: event.message || event.code || 'operation failed',
        updatedAt: event.ts || prev.updatedAt,
        result: null,
      };
    } else if (event.event === 'autoscript:operation_skipped') {
      const prev = cloneObject(operationState[event.operationId], {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      });
      operationState[event.operationId] = {
        ...prev,
        status: 'skipped',
        runs: Number(prev.runs || 0) + 1,
        lastError: null,
        updatedAt: event.ts || prev.updatedAt,
        result: {
          code: event.code || null,
          reason: event.reason || null,
        },
      };
    } else if (event.event === 'autoscript:operation_terminal') {
      const prev = cloneObject(operationState[event.operationId], {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      });
      operationState[event.operationId] = {
        ...prev,
        status: 'done',
        runs: Number(prev.runs || 0) + 1,
        lastError: null,
        updatedAt: event.ts || prev.updatedAt,
        result: {
          terminalDoneCode: event.code || null,
        },
      };
    } else if (event.event === 'autoscript:stop') {
      state = {
        ...state,
        active: false,
        reason: event.reason || state.reason || null,
        stoppedAt: event.ts || state.stoppedAt || null,
      };
    }
  }

  tracker.stopTs = last?.ts || tracker.stopTs || null;
  const summary = buildRunSummary(tracker, state.reason || null);
  const snapshot = {
    kind: 'autoscript_snapshot',
    version: 1,
    reason,
    createdAt: new Date().toISOString(),
    sourceJsonl: file,
    runId: summary.runId || null,
    profileId: summary.profileId || null,
    scriptName: summary.runName || null,
    summary,
    state: {
      state,
      subscriptionState,
      operationState,
      operationScheduleState: {},
      runtimeContext: { vars: {}, tabPool: null, currentTab: null },
      lastNavigationAt: 0,
      lastEvent,
    },
  };
  return snapshot;
}

function toOperationOrder(script) {
  return Array.isArray(script?.operations)
    ? script.operations.map((op) => String(op?.id || '').trim()).filter(Boolean)
    : [];
}

function buildDescendantSet(script, nodeId) {
  const dependents = new Map();
  for (const op of script.operations || []) {
    for (const dep of op.dependsOn || []) {
      if (!dependents.has(dep)) dependents.set(dep, new Set());
      dependents.get(dep).add(op.id);
    }
  }
  const seen = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of dependents.get(current) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

function buildResumeStateFromSnapshot(script, snapshot, fromNodeId = null) {
  const sourceState = snapshot?.state && typeof snapshot.state === 'object'
    ? snapshot.state
    : {};
  const sourceOps = sourceState.operationState && typeof sourceState.operationState === 'object'
    ? sourceState.operationState
    : {};
  const forceRunOperationIds = [];
  const operationState = {};
  const descendants = fromNodeId ? buildDescendantSet(script, fromNodeId) : null;

  for (const opId of toOperationOrder(script)) {
    const prev = sourceOps[opId] && typeof sourceOps[opId] === 'object'
      ? sourceOps[opId]
      : {
        status: 'pending',
        runs: 0,
        lastError: null,
        updatedAt: null,
        result: null,
      };
    if (!descendants) {
      operationState[opId] = {
        status: String(prev.status || 'pending'),
        runs: Math.max(0, Number(prev.runs || 0) || 0),
        lastError: prev.lastError || null,
        updatedAt: prev.updatedAt || null,
        result: prev.result ?? null,
      };
      continue;
    }

    if (descendants.has(opId)) {
      operationState[opId] = {
        status: 'pending',
        runs: Math.max(0, Number(prev.runs || 0) || 0),
        lastError: null,
        updatedAt: prev.updatedAt || null,
        result: null,
      };
      forceRunOperationIds.push(opId);
    } else {
      operationState[opId] = {
        status: 'done',
        runs: Math.max(1, Number(prev.runs || 1) || 1),
        lastError: null,
        updatedAt: prev.updatedAt || null,
        result: prev.result ?? { code: 'RESUME_SKIPPED_PREVIOUS_BRANCH' },
      };
    }
  }

  return {
    initialState: {
      state: {
        state: sourceState.state || {
          active: false,
          reason: null,
          startedAt: null,
          stoppedAt: null,
        },
        subscriptionState: sourceState.subscriptionState || {},
        operationState,
        operationScheduleState: sourceState.operationScheduleState || {},
        runtimeContext: sourceState.runtimeContext || { vars: {}, tabPool: null, currentTab: null },
        lastNavigationAt: Number(sourceState.lastNavigationAt || 0) || 0,
      },
    },
    forceRunOperationIds,
  };
}

function createMockOperationExecutor(fixture) {
  const source = fixture?.operations && typeof fixture.operations === 'object'
    ? fixture.operations
    : {};
  const queues = new Map(
    Object.entries(source).map(([key, value]) => [key, Array.isArray(value) ? [...value] : [value]]),
  );
  const defaultResult = fixture?.defaultResult && typeof fixture.defaultResult === 'object'
    ? fixture.defaultResult
    : { ok: true, code: 'OPERATION_DONE', message: 'mock operation done', data: { mock: true } };

  return ({ operation }) => {
    const key = String(operation?.id || '').trim();
    const queue = queues.get(key);
    const wildcard = queues.get('*');
    const next = queue && queue.length > 0
      ? queue.shift()
      : (wildcard && wildcard.length > 0 ? wildcard.shift() : defaultResult);
    return next;
  };
}

async function handleValidate(args) {
  const filePath = collectPositionals(args)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript validate <file>');
  }
  const { sourcePath, validation } = loadAndValidateAutoscript(filePath);
  console.log(JSON.stringify({
    ok: validation.ok,
    file: sourcePath,
    errors: validation.errors,
    warnings: validation.warnings,
    operationOrder: validation.topologicalOrder,
  }, null, 2));
  if (!validation.ok) {
    process.exitCode = 1;
  }
}

async function handleExplain(args) {
  const filePath = collectPositionals(args)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript explain <file>');
  }
  const { script, sourcePath } = loadAndValidateAutoscript(filePath);
  const explained = explainAutoscript(script);
  console.log(JSON.stringify({
    ok: explained.ok,
    file: sourcePath,
    ...explained,
  }, null, 2));
}

async function executeAutoscriptRuntime({
  commandName,
  script,
  sourcePath,
  profileId,
  jsonlPath,
  summaryPath,
  runnerOptions = {},
  extraStartPayload = {},
}) {
  let jsonlWriteError = null;
  const summaryTracker = createRunSummaryTracker({
    file: sourcePath,
    profileId,
    runId: null,
  });
  const appendRunJsonl = (payload) => {
    if (!jsonlPath) return;
    if (jsonlWriteError) return;
    try {
      appendJsonLine(jsonlPath, payload);
    } catch (err) {
      jsonlWriteError = err;
      console.error(JSON.stringify({
        event: 'autoscript:jsonl_error',
        file: jsonlPath,
        message: err?.message || String(err),
      }));
    }
  };

  const runner = new AutoscriptRunner({
    ...script,
    profileId,
  }, {
    profileId,
    ...runnerOptions,
    log: (payload) => {
      console.log(JSON.stringify(payload));
      appendRunJsonl(payload);
      applyRunSummaryEvent(summaryTracker, payload);
      safeAppendProgressEvent({
        source: 'autoscript.runtime',
        mode: 'autoscript',
        profileId: payload.profileId || profileId,
        runId: payload.runId || null,
        event: payload.event || 'autoscript.log',
        payload,
      });
    },
  });

  const running = await runner.start();
  summaryTracker.runId = running.runId;
  safeAppendProgressEvent({
    source: 'autoscript.command',
    mode: 'autoscript',
    profileId,
    runId: running.runId,
    event: `${commandName}.start`,
    payload: {
      file: sourcePath,
      profileId,
      runId: running.runId,
      ...extraStartPayload,
    },
  });
  console.log(JSON.stringify({
    ok: true,
    command: commandName,
    file: sourcePath,
    profileId,
    runId: running.runId,
    message: 'Autoscript runtime started. Press Ctrl+C to stop.',
    ...extraStartPayload,
  }, null, 2));
  appendRunJsonl({
    runId: running.runId,
    profileId,
    event: `${commandName}:run_start`,
    ts: new Date().toISOString(),
    file: sourcePath,
    jsonlPath,
    ...extraStartPayload,
  });

  const onSigint = () => {
    running.stop('signal_interrupt');
  };
  process.once('SIGINT', onSigint);

  const done = await running.done.finally(() => {
    process.removeListener('SIGINT', onSigint);
  });
  summaryTracker.stopTs = new Date().toISOString();
  const summaryPayload = buildRunSummary(summaryTracker, done?.reason || null);
  if (summaryPath) {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, `${JSON.stringify(summaryPayload, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    event: 'autoscript:run_summary',
    runId: running.runId,
    profileId,
    summaryPath,
    summary: summaryPayload,
  }, null, 2));
  safeAppendProgressEvent({
    source: 'autoscript.command',
    mode: 'autoscript',
    profileId,
    runId: running.runId,
    event: `${commandName}.stop`,
    payload: {
      file: sourcePath,
      profileId,
      runId: running.runId,
      reason: done?.reason || null,
      ...extraStartPayload,
    },
  });
  appendRunJsonl({
    runId: running.runId,
    profileId,
    event: `${commandName}:run_stop`,
    ts: new Date().toISOString(),
    file: sourcePath,
    reason: done?.reason || null,
    ...extraStartPayload,
  });
  appendRunJsonl({
    runId: running.runId,
    profileId,
    event: `${commandName}:run_summary`,
    ts: new Date().toISOString(),
    summaryPath,
    summary: summaryPayload,
    ...extraStartPayload,
  });

  return {
    done,
    summaryPath,
    summary: summaryPayload,
  };
}

async function handleRun(args) {
  const filePath = collectPositionals(args)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript run <file> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]');
  }
  const profileOverride = readFlagValue(args, ['--profile', '-p']);
  const jsonlPathRaw = readFlagValue(args, ['--jsonl-file', '--jsonl']);
  const jsonlPath = jsonlPathRaw ? path.resolve(jsonlPathRaw) : null;
  const summaryPathRaw = readFlagValue(args, ['--summary-file', '--summary']);
  const summaryPath = summaryPathRaw
    ? path.resolve(summaryPathRaw)
    : buildDefaultSummaryPath(jsonlPath);
  const { script, sourcePath, validation } = loadAndValidateAutoscript(filePath);
  if (!validation.ok) {
    console.log(JSON.stringify({
      ok: false,
      file: sourcePath,
      errors: validation.errors,
      warnings: validation.warnings,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const profileId = profileOverride || script.profileId || getDefaultProfile();
  if (!profileId) {
    throw new Error('profileId is required. Set in script or pass --profile <id>');
  }

  await executeAutoscriptRuntime({
    commandName: 'autoscript.run',
    script,
    sourcePath,
    profileId,
    jsonlPath,
    summaryPath,
  });
}

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
  try {
    return {
      resolvedPath: resolved,
      payload: JSON.parse(fs.readFileSync(resolved, 'utf8')),
    };
  } catch (err) {
    throw new Error(`Invalid JSON file: ${resolved} (${err?.message || String(err)})`);
  }
}

async function handleSnapshot(args) {
  const valueFlags = new Set(['--out', '-o']);
  const filePath = collectPositionals(args, 2, valueFlags)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript snapshot <jsonl-file> [--out <snapshot-file>]');
  }
  const outRaw = readFlagValue(args, ['--out', '-o']);
  const { resolvedPath, rows } = readJsonlEvents(filePath);
  const snapshot = buildSnapshotFromEvents({ events: rows, file: resolvedPath });
  const outputPath = outRaw
    ? path.resolve(outRaw)
    : (resolvedPath.endsWith('.jsonl')
      ? `${resolvedPath.slice(0, -'.jsonl'.length)}.snapshot.json`
      : `${resolvedPath}.snapshot.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    command: 'autoscript.snapshot',
    input: resolvedPath,
    output: outputPath,
    runId: snapshot.runId || null,
    profileId: snapshot.profileId || null,
    summary: snapshot.summary,
  }, null, 2));
}

async function handleReplay(args) {
  const valueFlags = new Set(['--summary-file', '--summary']);
  const filePath = collectPositionals(args, 2, valueFlags)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript replay <jsonl-file> [--summary-file <path>]');
  }
  const summaryPathRaw = readFlagValue(args, ['--summary-file', '--summary']);
  const { resolvedPath, rows } = readJsonlEvents(filePath);
  const snapshot = buildSnapshotFromEvents({ events: rows, file: resolvedPath, reason: 'log_replay' });
  const summaryPath = summaryPathRaw
    ? path.resolve(summaryPathRaw)
    : buildDefaultSummaryPath(resolvedPath);
  if (summaryPath) {
    fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
    fs.writeFileSync(summaryPath, `${JSON.stringify(snapshot.summary, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify({
    ok: true,
    command: 'autoscript.replay',
    input: resolvedPath,
    summaryPath,
    summary: snapshot.summary,
  }, null, 2));
}

async function handleResume(args) {
  const valueFlags = new Set(['--profile', '-p', '--snapshot', '--from-node', '--jsonl-file', '--jsonl', '--summary-file', '--summary']);
  const filePath = collectPositionals(args, 2, valueFlags)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript resume <file> --snapshot <snapshot-file> [--from-node <nodeId>] [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]');
  }
  const snapshotPathRaw = readFlagValue(args, ['--snapshot']);
  if (!snapshotPathRaw) {
    throw new Error('autoscript resume requires --snapshot <snapshot-file>');
  }
  const fromNode = readFlagValue(args, ['--from-node']);
  const profileOverride = readFlagValue(args, ['--profile', '-p']);
  const jsonlPathRaw = readFlagValue(args, ['--jsonl-file', '--jsonl']);
  const jsonlPath = jsonlPathRaw ? path.resolve(jsonlPathRaw) : null;
  const summaryPathRaw = readFlagValue(args, ['--summary-file', '--summary']);
  const summaryPath = summaryPathRaw ? path.resolve(summaryPathRaw) : buildDefaultSummaryPath(jsonlPath);

  const { payload: snapshot, resolvedPath: snapshotPath } = readJsonFile(snapshotPathRaw);
  const { script, sourcePath, validation } = loadAndValidateAutoscript(filePath);
  if (!validation.ok) {
    console.log(JSON.stringify({
      ok: false,
      file: sourcePath,
      errors: validation.errors,
      warnings: validation.warnings,
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (fromNode && !script.operations.some((op) => op.id === fromNode)) {
    throw new Error(`Unknown --from-node operation id: ${fromNode}`);
  }

  const profileId = profileOverride || snapshot?.profileId || script.profileId || getDefaultProfile();
  if (!profileId) {
    throw new Error('profileId is required. Set in script or pass --profile <id>');
  }
  const resumeState = buildResumeStateFromSnapshot(script, snapshot, fromNode || null);
  await executeAutoscriptRuntime({
    commandName: 'autoscript.resume',
    script,
    sourcePath,
    profileId,
    jsonlPath,
    summaryPath,
    runnerOptions: {
      initialState: resumeState.initialState,
      forceRunOperationIds: resumeState.forceRunOperationIds,
    },
    extraStartPayload: {
      snapshotPath,
      fromNode: fromNode || null,
    },
  });
}

async function handleMockRun(args) {
  const valueFlags = new Set(['--profile', '-p', '--fixture', '--jsonl-file', '--jsonl', '--summary-file', '--summary']);
  const filePath = collectPositionals(args, 2, valueFlags)[0];
  if (!filePath) {
    throw new Error('Usage: camo autoscript mock-run <file> --fixture <fixture.json> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]');
  }
  const fixturePathRaw = readFlagValue(args, ['--fixture']);
  if (!fixturePathRaw) {
    throw new Error('autoscript mock-run requires --fixture <fixture.json>');
  }
  const profileOverride = readFlagValue(args, ['--profile', '-p']);
  const jsonlPathRaw = readFlagValue(args, ['--jsonl-file', '--jsonl']);
  const jsonlPath = jsonlPathRaw ? path.resolve(jsonlPathRaw) : null;
  const summaryPathRaw = readFlagValue(args, ['--summary-file', '--summary']);
  const summaryPath = summaryPathRaw ? path.resolve(summaryPathRaw) : buildDefaultSummaryPath(jsonlPath);

  const { payload: fixture, resolvedPath: fixturePath } = readJsonFile(fixturePathRaw);
  const { script, sourcePath, validation } = loadAndValidateAutoscript(filePath);
  if (!validation.ok) {
    console.log(JSON.stringify({
      ok: false,
      file: sourcePath,
      errors: validation.errors,
      warnings: validation.warnings,
    }, null, 2));
    process.exitCode = 1;
    return;
  }
  const profileId = profileOverride || fixture?.profileId || script.profileId || 'mock-profile';
  await executeAutoscriptRuntime({
    commandName: 'autoscript.mock_run',
    script,
    sourcePath,
    profileId,
    jsonlPath,
    summaryPath,
    runnerOptions: {
      skipValidation: fixture?.skipValidation !== false,
      mockEvents: Array.isArray(fixture?.events) ? fixture.events : [],
      mockEventBaseDelayMs: Math.max(0, Number(fixture?.mockEventBaseDelayMs ?? 0) || 0),
      stopWhenMockEventsExhausted: fixture?.stopWhenMockEventsExhausted !== false,
      executeMockOperation: createMockOperationExecutor(fixture),
    },
    extraStartPayload: {
      fixturePath,
    },
  });
}

export async function handleAutoscriptCommand(args) {
  const sub = args[1];
  switch (sub) {
    case 'validate':
      return handleValidate(args);
    case 'explain':
      return handleExplain(args);
    case 'snapshot':
      return handleSnapshot(args);
    case 'replay':
      return handleReplay(args);
    case 'run':
      return handleRun(args);
    case 'resume':
      return handleResume(args);
    case 'mock-run':
      return handleMockRun(args);
    default:
      console.log(`Usage: camo autoscript <validate|explain|snapshot|replay|run|resume|mock-run> [args]

Commands:
  validate <file>                                   Validate autoscript schema and references
  explain <file>                                    Print normalized graph and defaults
  snapshot <jsonl-file> [--out <snapshot-file>]     Build resumable snapshot from run JSONL
  replay <jsonl-file> [--summary-file <path>]       Rebuild summary from run JSONL
  run <file> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>] Run autoscript runtime
  resume <file> --snapshot <snapshot-file> [--from-node <nodeId>] [--profile <id>] [--jsonl-file <path>] [--summary-file <path>] Resume from snapshot
  mock-run <file> --fixture <fixture.json> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>] Run in mock replay mode
`);
  }
}
