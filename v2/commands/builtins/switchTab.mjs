// camo v2 builtin: `camo switch-tab --tab-id <n> [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'switch-tab';
function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const tabId = parseInt(parsed.named?.tabId, 10);
  if (isNaN(tabId) || tabId < 0) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'tabId', value: parsed.named?.tabId } });
  const reply = await sendCommand(transport, { cmd: 'switch-tab', args: { profile, tabId } });
  return { cmd: 'switch-tab', profile, tabId, switched: reply.payload?.switched === true, url: reply.payload?.url ?? null, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
