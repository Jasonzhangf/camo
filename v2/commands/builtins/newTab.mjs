// camo v2 builtin: `camo new-tab [--url <url>] [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'new-tab';
function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const url = parsed.named?.url ?? null;
  const reply = await sendCommand(transport, { cmd: 'new-tab', args: { profile, url } });
  return { cmd: 'new-tab', profile, tabId: reply.payload?.tabId ?? null, url: reply.payload?.url ?? '', created: reply.payload?.created === true, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
