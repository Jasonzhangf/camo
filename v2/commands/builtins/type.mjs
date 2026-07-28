// camo v2 builtin: `camo type <text> [--selector ...] [--delay ms]`
//
// The text is the single positional argument and is required.
// --delay must be a non-negative integer in [0..5000] (already
// validated by parsers/flags.mjs).

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'type';

function safeProfile(profileId) {
  const id = String(profileId || '').trim();
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
  const text = String(parsed.positional?.[0] || '');
  if (!text) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'text' } });
  }
  const selector = parsed.named?.selector ?? null;
  const delay = parsed.named?.delay != null ? Number(parsed.named.delay) : 0;

  const reply = await sendCommand(transport, {
    cmd: 'type',
    args: { profile, text, selector, delay },
  });
  return {
    cmd: 'type',
    profile,
    selector,
    text,
    delay,
    typedChars: reply.payload?.typedChars || text.length,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
