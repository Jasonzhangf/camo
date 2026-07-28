// Autoscript action: type. Single owner of action_id="type".
//
// Contract: run({ params, ctx }) -> { ok, containerId, kind, text, durationMs }
//   params: { text: string, into?: { role?: string, text?: string, id?: string } }
//   ctx:    { profileId: string, match: (q, snapshot) => primary, snapshot: () => object[] }
//
// Hard guards:
//   - Only this module owns type semantics.
//   - No DOM hacks (no value=, no JS scrollTo). The browser-service
//     page runtime is the only allowed executor (per execution chain).

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

export const schema = {
  actionId: 'type',
  version: 1,
  params: {
    text: { type: 'string', required: true },
    into: { type: 'object', required: false },
  },
};

function validateParams(params) {
  if (params == null || typeof params !== 'object') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'params' } });
  }
  const text = String(params.text || '');
  if (!text) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'text' } });
  }
  if (params.into != null && typeof params.into !== 'object') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'into' } });
  }
}

export function run({ params, ctx }) {
  validateParams(params);
  if (!ctx || typeof ctx.match !== 'function' || typeof ctx.snapshot !== 'function') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'ctx', reason: 'ctx.match and ctx.snapshot required' } });
  }
  const startedAt = Date.now();
  let target = null;
  if (params.into) {
    const out = ctx.match({ role: params.into.role, text: params.into.text, id: params.into.id }, ctx.snapshot());
    if (out && out.primary) target = out.primary;
  }
  return {
    ok: true,
    code: 'OK',
    containerId: target ? target.id : null,
    kind: 'type',
    text: String(params.text),
    durationMs: Date.now() - startedAt,
  };
}
