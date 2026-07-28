// camo v2 protocol — v1.
//
// Single source of truth for wire protocol constants. The contracts
// builders/parsers import these values and reject anything that does
// not match.
//
// Hard guards:
//   - VERSION and KINDS are immutable. Bumping them requires a new
//     directory under contracts/{ws,http}_messages/<new-version>/.
//   - Ad-hoc JSON on the wire is forbidden (policy type-lock+versioned).

export const VERSION = 'camo.v2.protocol/v1';

// WS message kinds (client <-> browser-service).
export const WS_KINDS = Object.freeze({
  HELLO:        'hello',
  READY:        'ready',
  COMMAND:      'command',
  RESULT:       'result',
  EVENT:        'event',
  ERROR:        'error',
  PING:         'ping',
  PONG:         'pong',
});

// HTTP request/response kinds.
export const HTTP_KINDS = Object.freeze({
  HEALTH:       'health',
  COMMAND:      'command',
  RESULT:       'result',
  ERROR:        'error',
});

// Common command ids for the L4 layer. The v2/commands/registry
// owns the full table; this list is a closed set of well-known ids.
export const COMMAND_IDS = Object.freeze([
  'start', 'stop', 'goto', 'click', 'type', 'snapshot',
]);

export function isCommandId(id) {
  return COMMAND_IDS.includes(String(id || ''));
}
