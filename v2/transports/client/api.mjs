// camo v2 unified client API. Module id=transports.client.
//
// Single L4 surface: sendCommand({cmd, args}) wraps WS client; REST
// helpers wrap HTTP client. Imports only the builders/parsers; no
// business semantics, no fallback, no v1 imports.
//
// Hard guards:
//   - All wire IO goes through WS/HTTP client modules.
//   - On any transport error we re-throw with CamoError carrying the
//     projected code from the wire reply (no swallowing).

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand as wsSendCommand } from '../ws/client.mjs';
import { sendRequest as httpSendRequest } from '../http/client.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }

// All 28 commands supported by camo v2 (kebab-case)
const ALLOWED_CMDS = new Set([
  'click', 'close-tab', 'daemon', 'evaluate', 'fetch-page', 'find-elements',
  'get-cookies', 'get-page-info', 'get-readable', 'get-text', 'goto', 'hover',
  'list-tabs', 'new-tab', 'screenshot', 'scroll', 'scroll-and-collect', 'select',
  'set-cookies', 'set-user-agent', 'set-viewport', 'snapshot', 'start', 'stop',
  'type', 'upload', 'wait', 'wait-dom-stable'
]);

function assertCmd(cmd) {
  if (!ALLOWED_CMDS.has(String(cmd || ''))) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'cmd', value: cmd, allowed: [...ALLOWED_CMDS] } });
  }
}

export async function sendCommand(transport, { cmd, args, id } = {}) {
  assertCmd(cmd);
  return await wsSendCommand(transport, { kind: 'command', payload: { cmd, args: args ?? {} }, id });
}

export async function sendRequest(transport, { method, path, body, id } = {}) {
  return await httpSendRequest(transport, { method, path, body, id });
}

export function describe() {
  return {
    moduleId: 'transports.client',
    layer: 'L3_transport',
    role: 'cli-side facade over ws+http clients',
    commands: [...ALLOWED_CMDS].sort(),
  };
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
}
