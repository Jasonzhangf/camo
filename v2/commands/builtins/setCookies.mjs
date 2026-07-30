// camo v2 builtin: `camo set-cookies --cookies <json> [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'set-cookies';
function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  let cookies = parsed.named?.cookies;
  if (typeof cookies === 'string') { try { cookies = JSON.parse(cookies); } catch { throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'cookies', reason: 'invalid JSON' } }); } }
  if (!Array.isArray(cookies) || cookies.length === 0) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'cookies' } });
  const reply = await sendCommand(transport, { cmd: 'set-cookies', args: { profile, cookies } });
  return { cmd: 'set-cookies', profile, count: reply.payload?.count ?? 0, set: reply.payload?.set === true, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
