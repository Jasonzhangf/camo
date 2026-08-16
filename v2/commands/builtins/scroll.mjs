// camo v2 builtin: `camo scroll --x <dx> --y <dy> [--at-x <px>] [--at-y <px>] [--profile <id>]`
//
// Scroll the active page by delta pixels at the given pointer position
// (default: viewport center). At least one of x/y must be non-zero.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'scroll';

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
  const dx = parsed.named?.x ?? 0;
  const dy = parsed.named?.y ?? 0;
  const atX = parsed.named?.atX != null ? Number(parsed.named.atX) : null;
  const atY = parsed.named?.atY != null ? Number(parsed.named.atY) : null;

  if (typeof dx !== 'number' || !Number.isFinite(dx)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'x', value: dx } });
  }
  if (typeof dy !== 'number' || !Number.isFinite(dy)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'y', value: dy } });
  }
  if (dx === 0 && dy === 0) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'x|y', reason: 'at least one of --x or --y must be non-zero' },
    });
  }
  for (const [flag, value] of [['at-x', atX], ['at-y', atY]]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: flag, value } });
    }
  }

  const reply = await sendCommand(transport, {
    cmd: 'scroll',
    args: { profile, dx, dy, atX, atY },
  });
  return {
    cmd: 'scroll',
    profile,
    dx,
    dy,
    atX,
    atY,
    scrolled: reply.payload?.scrolled === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
