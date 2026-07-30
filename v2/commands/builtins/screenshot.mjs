// camo v2 builtin: `camo screenshot [--path <file>] [--profile <id>]`
//
// Take a screenshot of the active page. Defaults to PNG in temp dir.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
import { resolve } from 'path';
import { tmpdir } from 'os';

export const cmd = 'screenshot';

function safeProfile(profileId) {
  const id = String(profileId || '').trim();
  if (!id) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  }
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const path = parsed.named?.path || resolve(tmpdir(), `camo-screenshot-${Date.now()}.png`);

  if (typeof path !== 'string' || !path) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'path', value: path } });
  }

  const reply = await sendCommand(transport, {
    cmd: 'screenshot',
    args: { profile, path },
  });
  return {
    cmd: 'screenshot',
    profile,
    path,
    saved: reply.payload?.saved === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
