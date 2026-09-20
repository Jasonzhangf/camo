// camo v2 builtin: `camo status`
//
// Read-only projection of daemon, session, target, execution, and reclamation
// state. Status never starts a daemon or browser and never touches idle time.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'status';

function optionalId(value, field) {
  if (value == null) return null;
  const id = String(value).trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: id } });
  }
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = optionalId(parsed.named?.profile, 'profile');
  const target = optionalId(parsed.named?.target, 'target');
  const reply = await sendCommand(transport, {
    cmd: 'status',
    args: { profile, target },
  });
  return {
    cmd: 'status',
    ...(reply.payload || {}),
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
