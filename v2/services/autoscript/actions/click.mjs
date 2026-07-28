// Autoscript action: click. Single owner of action_id="click".
//
// Contract: run({ params, ctx }) -> { ok, containerId, kind, durationMs }
//   params: { role?: string, text?: string, id?: string, timeoutMs?: number }
//   ctx:    { profileId: string, match: (q, snapshot) => primary, snapshot: () => object[] }
//
// Hard guards:
//   - Only this module owns click semantics.
//   - Must not throw on input validation; instead returns { ok:false, code } so
//     upstream lifecycle can capture and decide retry/terminal.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

export const schema = {
  actionId: 'click',
  version: 1,
  params: {
    role: { type: 'string', required: false },
    text: { type: 'string', required: false },
    id:   { type: 'string', required: false },
    timeoutMs: { type: 'number', required: false, min: 0 },
  },
};

function validateParams(params) {
  if (params == null || typeof params !== 'object') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'params' } });
  }
  if (params.role == null && params.text == null && params.id == null) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'query', reason: 'one of role/text/id required' } });
  }
  if (params.timeoutMs != null) {
    const t = Number(params.timeoutMs);
    if (!Number.isFinite(t) || t < 0) {
      throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'timeoutMs', value: params.timeoutMs } });
    }
  }
}

export function run({ params, ctx }) {
  validateParams(params);
  if (!ctx || typeof ctx.match !== 'function' || typeof ctx.snapshot !== 'function') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'ctx', reason: 'ctx.match and ctx.snapshot required' } });
  }
  const startedAt = Date.now();
  const out = ctx.match({ role: params.role, text: params.text, id: params.id }, ctx.snapshot());
  if (!out || !out.primary) {
    return { ok: false, code: 'E_STATE_NOT_FOUND', containerId: null, durationMs: Date.now() - startedAt };
  }
  return {
    ok: true,
    code: 'OK',
    containerId: out.primary.id,
    kind: 'click',
    durationMs: Date.now() - startedAt,
  };
}
