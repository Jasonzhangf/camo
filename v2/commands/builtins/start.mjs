// camo v2 builtin: `camo start`
//
// Thin orchestrator on top of transports.client. Builds the wire
// payload from `parsed` and dispatches a single command over WS.
// No business semantics here; the browser-service process owns the
// session lifecycle.
//
// Hard guards:
//   - profile id must match [a-zA-Z0-9._-]+ (already checked by parser
//     when --profile was supplied; if --profile omitted we still
//     normalise the env/default value).
//   - No retry; no fallback. First failure is reported.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'start';

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
  const url = parsed.named?.url ?? null;
  const headless = parsed.named?.headless === true;
  const reply = await sendCommand(transport, {
    cmd: 'start',
    args: { profile, url, headless },
  });
  return {
    cmd: 'start',
    sessionId: reply.payload?.sessionId || null,
    profile,
    headless,
    url,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
