// camo v2 builtin: `camo set-viewport --width <px> --height <px> [--profile <id>]`
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
export const cmd = 'set-viewport';
function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}
export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  const profile = safeProfile(parsed.profile);
  const width = parseInt(parsed.named?.width, 10);
  const height = parseInt(parsed.named?.height, 10);
  if (isNaN(width) || width <= 0) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'width', value: parsed.named?.width } });
  if (isNaN(height) || height <= 0) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'height', value: parsed.named?.height } });
  const reply = await sendCommand(transport, { cmd: 'set-viewport', args: { profile, width, height } });
  return { cmd: 'set-viewport', profile, width, height, set: reply.payload?.set === true, issuedAt: new Date().toISOString(), traceId: ctx.traceId || null };
}
