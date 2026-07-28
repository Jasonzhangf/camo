// camo v2 builtin dispatcher. Module id=commands.builtins.
//
// Single entry that the shell layer uses. Loads every builtin
// dynamically by `cmd` and exposes a uniform `run(cmd, transport, args, ctx)`
// plus the static lookup table.
//
// Hard guards:
//   - No fallback for unknown cmd. registry.json is the source of truth.
//   - Each builtin returns a Promise that resolves to a plain payload;
//     transports wrap it with build() and the WS layer adds the envelope.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { look as registryLook } from '../registry/registry.mjs';

import * as start from './start.mjs';
import * as stop from './stop.mjs';
import * as goto from './goto.mjs';
import * as click from './click.mjs';
import * as type from './type.mjs';

const BUILTINS = { start, stop, goto, click, type };

export function list() {
  return Object.keys(BUILTINS).sort();
}

export function isBuiltin(cmd) {
  return Object.prototype.hasOwnProperty.call(BUILTINS, String(cmd || ''));
}

export async function run(cmd, transport, parsed = {}, ctx = {}) {
  const c = String(cmd || '');
  const spec = registryLook(c); // throws on unknown
  if (!isBuiltin(c)) {
    throw new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { resource: 'builtin', cmd: c } });
  }
  const mod = BUILTINS[c];
  if (typeof mod.run !== 'function') {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'builtins.run', cmd: c, reason: 'no run() export' } });
  }
  return await mod.run(transport, parsed, ctx);
}

export function describe() {
  return {
    moduleId: 'commands.builtins',
    layer: 'L4_command',
    count: list().length,
    cmds: list(),
    modules: Object.fromEntries(Object.entries(BUILTINS).map(([k, m]) => [k, m.cmd])),
  };
}
