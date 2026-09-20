// camo v2 builtin: `camo back [--target <t_id>] [--profile <id>]`
//
// Navigate the active page back one history entry.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'back';

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const target = parsed.named?.target || null;
  const reply = await sendCommand(transport, { cmd: 'back', args: { profile, target } });
  return {
    cmd: 'back',
    profile,
    target: reply.payload?.target || target,
    navigated: reply.payload?.navigated === true,
    finalUrl: reply.payload?.finalUrl || null,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
