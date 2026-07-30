// camo v2 builtin: `camo upload --selector <css> --file <path> [--profile <id>]`
//
// Upload a file to an input[type=file] element.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'upload';

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
  const selector = parsed.named?.selector || '';
  const file = parsed.named?.file || '';

  if (typeof selector !== 'string' || !selector.trim()) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  }
  if (typeof file !== 'string' || !file.trim()) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'file' } });
  }

  const reply = await sendCommand(transport, {
    cmd: 'upload',
    args: { profile, selector, file },
  });
  return {
    cmd: 'upload',
    profile,
    selector,
    file,
    uploaded: reply.payload?.uploaded === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
