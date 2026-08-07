// camo v2 builtin: `camo wait [--for <selector|text|url>] [--timeout <ms>] [--profile <id>]`
//
// Wait for a condition to be satisfied. Default timeout 30000ms.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'wait';

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  }
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const for_ = parsed.named?.for || 'load';
  const timeout = parsed.named?.timeout ?? 30000;

  const validForValues = ['load', 'domcontentloaded', 'networkidle', 'selector', 'text', 'url'];
  if (!validForValues.includes(for_)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'for', value: for_, allowed: validForValues },
    });
  }

  if (typeof timeout !== 'number' || timeout < 0 || !Number.isFinite(timeout)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'timeout', value: timeout } });
  }

  const target = parsed.named?.target || null;

  const reply = await sendCommand(transport, {
    cmd: 'wait',
    args: { profile, for: for_, timeout, target },
  });
  return {
    cmd: 'wait',
    profile,
    for: for_,
    timeout,
    target,
    satisfied: reply.payload?.satisfied === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
