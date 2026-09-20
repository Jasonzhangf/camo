// camo v2 builtin: `camo reload [--waitUntil <...>] [--target <t_id>] [--profile <id>]`
//
// Reload the active page.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'reload';

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
  const waitUntil = parsed.named?.waitUntil || 'load';
  const allowed = ['load', 'domcontentloaded', 'networkidle', 'commit'];
  if (!allowed.includes(waitUntil)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'waitUntil', value: waitUntil, allowed } });
  }
  const reply = await sendCommand(transport, { cmd: 'reload', args: { profile, target, waitUntil } });
  return {
    cmd: 'reload',
    profile,
    target: reply.payload?.target || target,
    reloaded: reply.payload?.reloaded === true,
    finalUrl: reply.payload?.finalUrl || null,
    statusCode: reply.payload?.statusCode ?? null,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
