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
import * as snapshot from './snapshot.mjs';
import * as scroll from './scroll.mjs';
import * as screenshot from './screenshot.mjs';
import * as wait from './wait.mjs';
import * as evaluate from './evaluate.mjs';
import * as upload from './upload.mjs';
import * as daemon from './daemon.mjs';
import * as select from './select.mjs';
import * as hover from './hover.mjs';
import * as getText from './getText.mjs';
import * as getPageInfo from './getPageInfo.mjs';
import * as findElements from './findElements.mjs';
import * as getReadable from './getReadable.mjs';
import * as newTab from './newTab.mjs';
import * as closeTab from './closeTab.mjs';
import * as listTabs from './listTabs.mjs';
import * as getCookies from './getCookies.mjs';
import * as setCookies from './setCookies.mjs';
import * as setUserAgent from './setUserAgent.mjs';
import * as setViewport from './setViewport.mjs';
import * as waitDomStable from './waitDomStable.mjs';
import * as scrollAndCollect from './scrollAndCollect.mjs';
import * as fetchPage from './fetchPage.mjs';


const BUILTINS = { start, stop, goto, click, type, snapshot, scroll, screenshot, wait, evaluate, upload, select, daemon, hover, getText, getPageInfo, findElements, getReadable, newTab, closeTab, listTabs, getCookies, setCookies, setUserAgent, setViewport, waitDomStable, scrollAndCollect, fetchPage };

export function list() {
  return Object.keys(BUILTINS).sort();
}

export function isBuiltin(cmd) {
  return Object.prototype.hasOwnProperty.call(BUILTINS, String(cmd || ''));
}

// Convert kebab-case to camelCase
function toCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export async function run(cmd, transport, parsed = {}, ctx = {}) {
  const c = String(cmd || '');
  // CLI sends kebab-case, builtins BUILTINS uses camelCase
  const camelCmd = c.includes('-') ? toCamel(c) : c;
  // Registry stores kebab-case commands
  const spec = registryLook(c); // throws on unknown (uses kebab-case)
  if (!isBuiltin(camelCmd)) {
    throw new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { resource: 'builtin', cmd: camelCmd } });
  }
  const mod = BUILTINS[camelCmd];
  if (typeof mod.run !== 'function') {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'builtins.run', cmd: camelCmd, reason: 'no run() export' } });
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
