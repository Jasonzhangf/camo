// camo v2 builtin: `camo evaluate --script <js> [--profile <id>]`
//
// Execute arbitrary JavaScript in the page context.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'evaluate';

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  }
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const script = parsed.named?.script || '';

  if (typeof script !== 'string' || !script.trim()) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'script' } });
  }

  const reply = await sendCommand(transport, {
    cmd: 'evaluate',
    args: { profile, script },
  });
  return {
    cmd: 'evaluate',
    profile,
    result: reply.payload?.result ?? null,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
