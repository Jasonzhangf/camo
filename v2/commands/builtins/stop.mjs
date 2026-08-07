// camo v2 builtin: `camo stop`
//
// Stops a session. Idempotent: returns the server-reported status
// (stopped / already_stopped / not_found) without re-throwing.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'stop';

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
  const reply = await sendCommand(transport, {
    cmd: 'stop',
    args: { profile },
  });
  return {
    cmd: 'stop',
    profile,
    state: reply.payload?.state || 'stopped',
    releasedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
