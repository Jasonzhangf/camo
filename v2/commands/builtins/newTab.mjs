// camo v2 builtin: `camo new-tab [--url <url>] [--target <t_id>] [--profile <id>]`
//
// Creates a new page in the target's browser context and returns a new stable
// target id for that page.
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'new-tab';
function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const target = parsed.named?.target ?? null;
  const url = parsed.named?.url ?? null;
  const reply = await sendCommand(transport, { cmd: 'new-tab', args: { profile, target, url } });
  return { cmd: 'new-tab', profile, target: reply.payload?.target ?? null, page: reply.payload?.page ?? null, url: reply.payload?.url ?? '', created: reply.payload?.created === true, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
