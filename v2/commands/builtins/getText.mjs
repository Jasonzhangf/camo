// camo v2 builtin: `camo get-text [--selector <css>] [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'get-text';
function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const selector = parsed.named?.selector ?? null;
  const reply = await sendCommand(transport, { cmd: 'get-text', args: { profile, selector } });
  return { cmd: 'get-text', profile, text: reply.payload?.text ?? '', length: reply.payload?.length ?? 0, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
