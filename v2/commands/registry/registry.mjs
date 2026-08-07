// camo v2 command registry. Module id=commands.registry.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { COMMAND_IDS } from '../../protocol/versions/v1.mjs';

// PKG_ROOT 由 bin/camo.mjs shim 注入；直接 node 启动时用本文件位置推导
const PKG_ROOT = process.env.CAMO_PKG_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let _cache = null;

function loadFile() {
  const file = path.join(PKG_ROOT, 'v2', 'commands', 'registry', 'registry.json');
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
