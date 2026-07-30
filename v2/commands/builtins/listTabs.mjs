// camo v2 builtin: `camo list-tabs [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'list-tabs';
function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const reply = await sendCommand(transport, { cmd: 'list-tabs', args: { profile } });
  return { cmd: 'list-tabs', profile, count: reply.payload?.count ?? 0, tabs: reply.payload?.tabs ?? [], issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
