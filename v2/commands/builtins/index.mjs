// camo v2 builtin dispatcher. Module id=commands.builtins.
//
// Single entry that the shell layer uses. Loads every builtin
// dynamically by `cmd` and exposes a uniform `run(cmd, transport, args, ctx)`
// plus the static lookup table.

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
import * as switchTab from './switchTab.mjs';
import * as multiOpen from './multiOpen.mjs';
import * as getCookies from './getCookies.mjs';
import * as setCookies from './setCookies.mjs';
import * as setUserAgent from './setUserAgent.mjs';
import * as setViewport from './setViewport.mjs';
import * as waitDomStable from './waitDomStable.mjs';
import * as scrollAndCollect from './scrollAndCollect.mjs';
import * as fetchPage from './fetchPage.mjs';
import * as login from './login.mjs';
import * as search from './search/index.mjs';

const BUILTINS = { start, stop, goto, search, click, type, snapshot, scroll, screenshot, wait, evaluate, upload, select, daemon, hover, getText, getPageInfo, findElements, getReadable, newTab, closeTab, listTabs, switchTab, multiOpen, getCookies, setCookies, setUserAgent, setViewport, waitDomStable, scrollAndCollect, fetchPage, login };

// Convert camelCase to kebab-case
const toKebab = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

export function list() {
  // Return kebab-case names to match registry convention
  return Object.keys(BUILTINS)
    .map(k => {
      const mod = BUILTINS[k];
      return mod.cmd ? toKebab(mod.cmd) : toKebab(k);
    })
    .sort();
}

export function isBuiltin(cmd) {
  if (!cmd) return false;
  const camelCmd = cmd.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  return Object.prototype.hasOwnProperty.call(BUILTINS, camelCmd);
}

export function describe() {
  return {
    moduleId: 'commands.builtins',
    layer: 'L4_command',
    count: Object.keys(BUILTINS).length,
    modules: Object.fromEntries(Object.entries(BUILTINS).map(([k, m]) => [k, m.cmd])),
  };
}

export async function run(cmd, transport, args, ctx) {
  if (!cmd) {
    throw new CamoError({ code: 'E_PROTO_NO_CMD', details: { reason: 'cmd is required' } });
  }
  const camelCmd = cmd.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!isBuiltin(camelCmd)) {
    throw new CamoError({
      code: 'E_PROTO_NO_HANDLER',
      details: { cmd, known: list() },
    });
  }
  const mod = BUILTINS[camelCmd];
  if (!mod.run) {
    throw new CamoError({
      code: 'E_IMPL_MISSING',
      details: { cmd, missing: 'run function' },
    });
  }
  return await mod.run(transport, args, ctx);
}

export { BUILTINS };
