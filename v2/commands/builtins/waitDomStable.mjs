// camo v2 builtin: `camo wait-dom-stable [--timeout <ms>] [--poll <ms>] [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'wait-dom-stable';
function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const timeout = parsed.named?.timeout ? parseInt(parsed.named.timeout, 10) : null;
  const pollInterval = parsed.named?.poll ? parseInt(parsed.named.poll, 10) : null;
  const reply = await sendCommand(transport, { cmd: 'wait-dom-stable', args: { profile, timeout, pollInterval } });
  return { cmd: 'wait-dom-stable', profile, stable: reply.payload?.stable === true, reason: reply.payload?.reason ?? null, elapsed: reply.payload?.elapsed ?? null, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
