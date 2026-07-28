// camo v2 command registry. Module id=commands.registry.
//
// Single owner for the cmd_id -> metadata table. Reads registry.json
// once at boot, caches it in-memory. Hot-reload is intentionally not
// supported (one source of truth; restart to add commands).
//
// Hard guards:
//   - No fallback for unknown cmd ids. look throws E_PROTO_NO_HANDLER.
//   - The returned spec is a frozen copy so callers cannot mutate it.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { COMMAND_IDS } from '../../protocol/versions/v1.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let _cache = null;

function loadFile() {
  const file = path.join(__dirname, 'registry.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (cause) {
    throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'read', path: file }, cause });
  }
  return raw;
}

function buildIndex(raw) {
  const map = new Map();
  for (const c of raw.commands || []) {
    if (!c.cmd || typeof c.cmd !== 'string') {
      throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'commands.registry.parse', reason: 'cmd missing or non-string' } });
    }
    if (!c.module || !c.args_schema || !c.docstring) {
      throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'commands.registry.parse', cmd: c.cmd, reason: 'module/args_schema/docstring required' } });
    }
    if (map.has(c.cmd)) {
      throw new CamoError({ code: 'E_STATE_DUPLICATE', details: { resource: 'command', cmd: c.cmd } });
    }
    map.set(c.cmd, Object.freeze({
      cmd: c.cmd,
      module: c.module,
      args_schema: Object.freeze(JSON.parse(JSON.stringify(c.args_schema))),
      docstring: c.docstring,
    }));
  }
  return map;
}

function ensureLoaded() {
  if (_cache) return _cache;
  const raw = loadFile();
  const index = buildIndex(raw);
  const builtinCmds = [...index.keys()].sort();
  const knownCmds = new Set([...builtinCmds, ...COMMAND_IDS]);
  _cache = Object.freeze({
    raw: Object.freeze(raw),
    index,
    knownCmds,
    builtinCmds,
  });
  return _cache;
}

// Test seam: allow forcing a reload after registry.json changes.
export function __enableTestRoot() { _cache = null; }
export function __resetForTest() { _cache = null; }

export function list() {
  return ensureLoaded().builtinCmds.slice();
}

export function knownAll() {
  return [...ensureLoaded().knownCmds].sort();
}

export function has(cmd) {
  return ensureLoaded().index.has(String(cmd || ''));
}

export function look(cmd) {
  const c = String(cmd || '');
  const found = ensureLoaded().index.get(c);
  if (!found) {
    throw new CamoError({
      code: 'E_PROTO_NO_HANDLER',
      details: { resource: 'command', cmd: c, known: ensureLoaded().builtinCmds },
    });
  }
  return found;
}

export function describe() {
  const cache = ensureLoaded();
  return {
    moduleId: 'commands.registry',
    layer: 'L4_command',
    count: cache.builtinCmds.length,
    cmds: cache.builtinCmds,
    schema_version: cache.raw.schema_version,
  };
}
