// camo v2 builtin: `camo goto <url>`
//
// Navigate the active page. URL is the single positional argument; it
// was validated by parsers/flags.mjs (must start with http(s)://).

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'goto';

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
  const url = String(parsed.positional?.[0] || '').trim();
  if (!url) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'url' } });
  }
  if (!/^https?:\/\//.test(url)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url', value: url } });
  }
  const waitUntil = parsed.named?.waitUntil || 'load';
  const reply = await sendCommand(transport, {
    cmd: 'goto',
    args: { profile, url, waitUntil },
  });
  return {
    cmd: 'goto',
    profile,
    url,
    waitUntil,
    navigated: reply.payload?.navigated === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
