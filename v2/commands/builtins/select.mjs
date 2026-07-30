// camo v2 builtin: `camo select --selector <css> --value <val> [--profile <id>]`
//
// Select an option in a <select> element by value.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'select';

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
  const value = parsed.named?.value || '';

  if (typeof selector !== 'string' || !selector.trim()) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  }
  if (typeof value !== 'string') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'value', value } });
  }

  const reply = await sendCommand(transport, {
    cmd: 'select',
    args: { profile, selector, value },
  });
  return {
    cmd: 'select',
    profile,
    selector,
    value,
    selected: reply.payload?.selected === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
