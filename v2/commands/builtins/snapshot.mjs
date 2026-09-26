// camo v2 builtin: `camo snapshot [--format json|yaml] [--profile <id>]`
//
// Return the current session/page state as a structured snapshot.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'snapshot';

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
  const format = parsed.named?.format || 'json';
  const target = parsed.named?.target || null;
  const rawDom = parsed.named?.rawDom === true || parsed.named?.rawDom === 'true';
  
  if (!['json', 'yaml'].includes(format)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'format', value: format, allowed: ['json', 'yaml'] },
    });
  }

  const reply = await sendCommand(transport, {
    cmd: 'snapshot',
    args: { profile, target, format, rawDom },
  });
  const payload = reply.payload || {};
  let data;
  if (payload.rawDom === true) {
    data = {
      format: 'raw-dom',
      rawDom: true,
      url: payload.url ?? null,
      documentId: payload.documentId ?? null,
      htmlLength: payload.htmlLength ?? 0,
      html: payload.html ?? '',
    };
  } else {
    data = {
      format: payload.format || 'semantic-json',
      snapshotId: payload.snapshotId ?? null,
      documentId: payload.documentId ?? null,
      url: payload.url ?? null,
      title: payload.title ?? '',
      viewport: payload.viewport ?? null,
      window: payload.window ?? null,
      tree: payload.tree ?? { nodes: [] },
    };
  }
  return {
    cmd: 'snapshot',
    profile,
    target: payload?.target || target,
    format,
    rawDom,
    data,
    issuedAt: new Date().toISOString(),
    traceId: ctx.traceId || null,
  };
}
