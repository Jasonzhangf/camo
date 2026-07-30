// camo v2 builtin: `camo scroll-and-collect [--scroll-count <n>] [--delay <ms>] [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'scroll-and-collect';
function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const scrollCount = parsed.named?.scrollCount ? parseInt(parsed.named.scrollCount, 10) : null;
  const scrollDelay = parsed.named?.delay ? parseInt(parsed.named.delay, 10) : null;
  const reply = await sendCommand(transport, { cmd: 'scroll-and-collect', args: { profile, scrollCount, scrollDelay } });
  return { cmd: 'scroll-and-collect', profile, scrolls: reply.payload?.scrolls ?? 0, items: reply.payload?.items ?? 0, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
