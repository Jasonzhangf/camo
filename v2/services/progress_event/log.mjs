// Progress event log. Single truth_owner for resource_id=progress_event.
//
// Append-only JSONL stream per run_id. Path:
//   ~/.camo/runs/<run_id>/events.jsonl
//
// Hard guards:
//   - Only this writer touches the file. Transports only fan out via
//     the daemon (see transports/daemon).
//   - Schema is strict: { ts, runId, profileId, source, mode, event, payload }.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

let _overrideRoot = null;
let _enabledTest = false;
export function __enableTestRoot() { _enabledTest = true; _overrideRoot = null; }
export function __setRunsRootForTest(p) {
  if (!_enabledTest) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setRunsRootForTest' } });
  _overrideRoot = p;
}

function runsRoot() {
  if (_overrideRoot) return _overrideRoot;
  const home = os.homedir();
  if (process.platform === 'win32') {
    const hasD = (() => { try { return fs.existsSync('D:\\'); } catch { return false; } })();
    return hasD ? path.join('D:\\', 'camo', 'runs') : path.join(home, '.camo', 'runs');
  }
  const envOverride = (process.env.CAMO_RUNS_ROOT || process.env.CAMO_PATHS_RUNS || '').trim();
  if (envOverride) return path.resolve(envOverride);
  return path.join(home, '.camo', 'runs');
}

function nowIso() { return new Date().toISOString(); }

function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

function runFile(runId) {
  return path.join(runsRoot(), safeId(runId, 'runId'), 'events.jsonl');
}

function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function buildRecord(input) {
  return {
    ts: nowIso(),
    // runId defaults to 'anonymous' if not provided. Callers should pass
    // a real runId when possible for proper event correlation.
    runId: input.runId ? safeId(input.runId, 'runId') : 'anonymous',
    profileId: input.profileId || null,
    source: String(input.source || '').trim() || 'unspecified',
    mode: String(input.mode || 'normal').trim().toLowerCase(),
    event: safeId(input.event, 'event'),
    payload: input.payload && typeof input.payload === 'object' ? input.payload : null,
  };
}

export function append(entry) {
  const rec = buildRecord(entry);
  const file = runFile(rec.runId);
  try {
    ensureParent(file);
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, 'utf8');
  } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'append', path: file, runId: rec.runId }, cause });
  }
  return rec;
}

export function readRecent(runId, opts = {}) {
  const file = runFile(runId);
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter(Boolean);
  const limit = Math.max(0, Number(opts.limit ?? 100) || 0);
  const slice = limit ? lines.slice(-limit) : lines;
  const out = [];
  for (const line of slice) {
    try { out.push(JSON.parse(line)); } catch (cause) {
      throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'read_jsonl', path: file }, cause });
    }
  }
  return out;
}

export function listRuns() {
  const root = runsRoot();
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const eventsFile = path.join(root, dir.name, 'events.jsonl');
    if (fs.existsSync(eventsFile)) out.push(dir.name);
  }
  return out.sort();
}
