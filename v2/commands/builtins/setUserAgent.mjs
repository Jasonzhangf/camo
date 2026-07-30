// camo v2 builtin: `camo set-user-agent --ua <string> [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'set-user-agent';
function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const userAgent = parsed.named?.ua ?? null;
  if (!userAgent || typeof userAgent !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'ua' } });
  const reply = await sendCommand(transport, { cmd: 'set-user-agent', args: { profile, userAgent } });
  return { cmd: 'set-user-agent', profile, userAgent, set: reply.payload?.set === true, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
