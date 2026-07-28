// Error envelope projector.
//
// Single source of truth: v2/contracts/error_envelope/codes.json
// Workflow:
//   throw new CamoError({code:'E_INPUT_MISSING_FIELD', details:{field:'profileId'}}) -- anywhere
//   -> projector.mjs::project(ce) returns { code, message, details }
//   -> projector.mjs::toWire(ce)     returns wire-ready JSON {code, message, details}.
//
// Anti-pattern: never construct user-facing message text inline in services.
// (Hard guard: only Error01Code + projector may produce user-visible text.)

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

let _codes = null;
function load() {
  if (_codes) return _codes;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'codes.json'), 'utf8'));
  const map = new Map();
  for (const e of raw.codes) map.set(e.code, e);
  _codes = { raw, map };
  return _codes;
}

export class CamoError extends Error {
  constructor({ code, message, details, cause } = {}) {
    if (!code || typeof code !== 'string') {
      super('CamoError requires code');
      this.code = 'E_INTERNAL_UNEXPECTED';
      this.details = { ...(details || {}), _missing_code: Boolean(code) };
      return;
    }
    const spec = load().map.get(code);
    super(spec ? spec.default_user_message : 'Unknown error');
    this.code = code;
    this.message_override = message;
    this.details = details || null;
    this.cause = cause || null;
    this.name = 'CamoError';
  }
}

export function isCamoError(value) {
  return value instanceof CamoError;
}

export function project(err) {
  if (!err) {
    return project(new CamoError({ code: 'E_INTERNAL_UNEXPECTED' }));
  }
  if (err instanceof CamoError) {
    return {
      code: err.code,
      message: err.message_override || err.message,
      details: err.details,
    };
  }
  // Unknown error type: classify as internal.
  return {
    code: 'E_INTERNAL_UNEXPECTED',
    message: 'Unexpected internal error.',
    details: { type: typeof err, name: err?.name, raw: String(err?.message || err) },
  };
}

export function toWire(err) {
  const out = project(err);
  if (out.details == null) delete out.details;
  return out;
}

export function knownCodes() {
  return [...load().map.keys()];
}

export function getSpec(code) {
  return load().map.get(code) || null;
}
