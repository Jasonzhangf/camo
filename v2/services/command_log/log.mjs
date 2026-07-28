// Command audit log. Single truth_owner for resource_id=command_log.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

let _enabledTest = false;
let _overrideRoot = null;
export function __enableTestRoot() { _enabledTest = true; _overrideRoot = null; }
export function __setRunsRootForTest(p) {
  if (!_enabledTest) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setRunsRootForTest' } });
  _overrideRoot = p;
}
export function __resetForTest() { _enabledTest = false; _overrideRoot = null; }

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

export function append(entry) {
  // Validate inputs OUTSIDE try so we don't mis-classify as E_IO_FILESYSTEM.
  const isTest = _enabledTest || entry?.__testWriter === true;
  if (!isTest && entry?.writer !== 'cli') {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'command_log.append', reason: 'only shell.cli may write; pass writer:"cli"' } });
  }
  const runId = safeId(entry?.runId, 'runId');
  const cmd = safeId(entry?.cmd, 'cmd');
  const file = path.join(runsRoot(), runId, 'commands.jsonl');

  const rec = {
    ts: nowIso(),
    runId,
    cmd,
    profileId: entry.profileId || null,
    status: entry.status === 'error' ? 'error' : 'ok',
    durationMs: Number.isFinite(entry.durationMs) ? Math.max(0, Math.floor(entry.durationMs)) : null,
    source: entry.source || 'cli',
    args: Array.isArray(entry.args) ? entry.args : [],
    error: entry.status === 'error' ? (entry.error || 'unknown') : null,
  };

  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(rec)}\n`, 'utf8');
  } catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'command_log.append', path: file, runId }, cause });
  }
  return rec;
}

export function read(runId, opts = {}) {
  const file = path.join(runsRoot(), safeId(runId, 'runId'), 'commands.jsonl');
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, 'utf8').split(/\n/).filter(Boolean);
  const limit = Math.max(0, Number(opts.limit ?? 100) || 0);
  const slice = limit ? lines.slice(-limit) : lines;
  const out = [];
  for (const line of slice) {
    try { out.push(JSON.parse(line)); } catch (cause) {
      throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'read', path: file }, cause });
    }
  }
  return out;
}
