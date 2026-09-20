// camo v2 builtin: `camo fetch-page <url> [--timeout <ms>] [--target <t_id>] [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'fetch-page';
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
  const url = String(parsed.positional?.[0] || '').trim();
  if (!url || !/^https?:\/\//.test(url)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url', value: url } });
  const timeout = parsed.named?.timeout ? parseInt(parsed.named.timeout, 10) : null;
  const reply = await sendCommand(transport, { cmd: 'fetch-page', args: { profile, target, url, timeout } });
  return { cmd: 'fetch-page', profile, target: reply.payload?.target || target, url, fetched: reply.payload?.fetched === true, fetchOk: reply.payload?.fetchOk === true, status: reply.payload?.status ?? null, bodyLength: reply.payload?.bodyLength ?? 0, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
