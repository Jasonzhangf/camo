// camo v2 builtin: `camo multi-open --urls <u1,u2,...> [--out-dir <dir>] [--prefix <name>] [--profile <id>]`
//
// Open multiple URLs in deterministic tab order, then capture a screenshot of each.
// URLs are given as a comma-separated list via `--urls`.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
import { PROFILE_ID_PATTERN } from '../../services/profile/storage_paths.mjs';

export const cmd = 'multi-open';

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!PROFILE_ID_PATTERN.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const raw = parsed.named?.urls ?? '';
  const urls = String(raw).split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'urls', reason: 'comma-separated http(s) url list required' } });
  }
  const outDir = parsed.named?.outDir ?? null;
  const prefix = parsed.named?.prefix ?? 'multi-open';

  const reply = await sendCommand(transport, {
    cmd: 'multi-open',
    args: { profile, urls, outDir, prefix },
  });
  return {
    cmd: 'multi-open',
    profile,
    opened: reply.payload?.opened ?? [],
    screenshots: reply.payload?.screenshots ?? [],
    errors: reply.payload?.errors ?? [],
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
