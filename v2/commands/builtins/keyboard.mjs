// camo v2 builtin: `camo keyboard press <key>`
//
// Keyboard input is a protocol primitive. Only an explicit allowlist of
// navigation/confirmation keys is exposed so callers cannot inject arbitrary
// browser shortcuts through this command.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'keyboard';

const ALLOWED_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  }
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const action = String(parsed.positional?.[0] || '');
  const key = String(parsed.positional?.[1] || '');
  if (action !== 'press') {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'action', value: action, allowed: ['press'] },
    });
  }
  if (!ALLOWED_KEYS.has(key)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'key', value: key, allowed: [...ALLOWED_KEYS] },
    });
  }
  const target = parsed.named?.target ?? null;
  const timeout = parsed.named?.timeout ?? null;

  const reply = await sendCommand(transport, {
    cmd: 'keyboard',
    args: { profile, target, action, key, timeout },
  });
  if (reply.payload?.pressed !== true) {
    throw new CamoError({
      code: 'E_PROTO_BAD_ENVELOPE',
      details: { field: 'pressed', value: reply.payload?.pressed },
    });
  }
  return {
    cmd: 'keyboard',
    profile,
    target: reply.payload?.target || target,
    action,
    key,
    pressed: true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
