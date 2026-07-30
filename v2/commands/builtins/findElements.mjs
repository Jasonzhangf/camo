// camo v2 builtin: `camo find-elements --selector <css>|--text <text> [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'find-elements';
function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const selector = parsed.named?.selector ?? null;
  const text = parsed.named?.text ?? null;
  const reply = await sendCommand(transport, { cmd: 'find-elements', args: { profile, selector, text } });
  return { cmd: 'find-elements', profile, count: reply.payload?.count ?? 0, elements: reply.payload?.elements ?? [], issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
