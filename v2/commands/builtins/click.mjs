// camo v2 builtin: `camo click --selector|--text [...]`
//
// "Exactly one of selector/text" invariant is enforced HERE, not at
// parse time, because the parser treats both as optional. Failure
// mode is E_INPUT_INVALID with explicit details.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'click';

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
  const selector = parsed.named?.selector ?? null;
  const text = parsed.named?.text ?? null;
  const button = parsed.named?.button ?? 'left';

  const hasSelector = typeof selector === 'string' && selector.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  if (hasSelector === hasText) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'selector|text', reason: 'exactly one of --selector or --text is required', selector, text },
    });
  }

  const reply = await sendCommand(transport, {
    cmd: 'click',
    args: { profile, selector, text, button },
  });
  return {
    cmd: 'click',
    profile,
    selector,
    text,
    button,
    clicked: reply.payload?.clicked === true,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
