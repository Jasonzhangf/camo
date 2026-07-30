// camo v2 builtin: `camo snapshot [--format json|yaml] [--profile <id>]`
//
// Return the current session/page state as a structured snapshot.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'snapshot';

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
  const format = parsed.named?.format || 'json';
  
  if (!['json', 'yaml'].includes(format)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'format', value: format, allowed: ['json', 'yaml'] },
    });
  }

  const reply = await sendCommand(transport, {
    cmd: 'snapshot',
    args: { profile, format },
  });
  return {
    cmd: 'snapshot',
    profile,
    format,
    data: reply.payload?.data ?? {},
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
