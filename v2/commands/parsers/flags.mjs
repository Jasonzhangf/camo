// camo v2 command-line parser. Module id=commands.parsers.
//
// Pure function: argv (string[]) -> {profile, cmd, named, positional, errors[]}.
// The single owner for argument decoding. Caller (commands.builtins or
// shell.cli) consumes the result; this module never throws on bad input
// — it collects errors in the `errors` array so the caller can either
// surface them inline or escalate to CamoError.
//
// Hard guards:
//   - Pattern check on every named field; enum check for enum types.
//   - Positional-arity enforced against args_schema.positional[].
//   - Every named field is normalized via the schema's type spec.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { has as registryHas, look as registryLook } from '../registry/registry.mjs';

const ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const URL_PATTERN = /^https?:\/\//;
const NON_NEG_INT = (n) => Number.isInteger(n) && n >= 0;

function fieldError(errors, field, message, value) {
  errors.push({ field, message, value });
}

function coerceNamed(name, spec, rawValue) {
  if (spec.required === true && rawValue === undefined) {
    return { ok: false, error: { field: name, message: 'required', value: null } };
  }
  if (rawValue === undefined) {
    return { ok: true, value: spec.default !== undefined ? spec.default : null };
  }
  switch (spec.type) {
    case 'string': {
      if (typeof rawValue !== 'string') return { ok: false, error: { field: name, message: 'must be string', value: rawValue } };
      if (spec.pattern === '^[a-zA-Z0-9._-]+$' && !ID_PATTERN.test(rawValue)) {
        return { ok: false, error: { field: name, message: 'must match [a-zA-Z0-9._-]+', value: rawValue } };
      }
      if (spec.pattern === '^https?://' && !URL_PATTERN.test(rawValue)) {
        return { ok: false, error: { field: name, message: 'must start with http(s)://', value: rawValue } };
      }
      if (spec.min_len && rawValue.length < spec.min_len) {
        return { ok: false, error: { field: name, message: `min length ${spec.min_len}`, value: rawValue } };
      }
      return { ok: true, value: rawValue };
    }
    case 'boolean': {
      if (typeof rawValue === 'boolean') return { ok: true, value: rawValue };
      if (rawValue === 'true' || rawValue === true) return { ok: true, value: true };
      if (rawValue === 'false' || rawValue === false) return { ok: true, value: false };
      return { ok: false, error: { field: name, message: 'must be boolean', value: rawValue } };
    }
    case 'integer': {
      const n = Number(rawValue);
      if (!Number.isInteger(n)) return { ok: false, error: { field: name, message: 'must be integer', value: rawValue } };
      if (typeof spec.min === 'number' && n < spec.min) return { ok: false, error: { field: name, message: `must be >= ${spec.min}`, value: n } };
      if (typeof spec.max === 'number' && n > spec.max) return { ok: false, error: { field: name, message: `must be <= ${spec.max}`, value: n } };
      return { ok: true, value: n };
    }
    case 'enum': {
      const v = String(rawValue);
      if (!Array.isArray(spec.values) || !spec.values.includes(v)) {
        return { ok: false, error: { field: name, message: `must be one of ${(spec.values || []).join(',')}`, value: rawValue } };
      }
      return { ok: true, value: v };
    }
    default:
      return { ok: false, error: { field: name, message: `unknown schema type ${spec.type}`, value: rawValue } };
  }
}

function looksLikeFlag(a) {
  return typeof a === 'string' && a.startsWith('--');
}

// parse(argv, opts?) -> { cmd, profile, named, positional, errors, missing_required, help }
// argv is what comes AFTER `camo <cmd>`. We add the cmd via opts.cmd or derive it.
export function parse(argv, opts = {}) {
  const errors = [];
  const named = {};
  const positional = [];
  const missing_required = [];
  const cmd = String(opts.cmd || '');

  if (!cmd) {
    errors.push({ field: 'cmd', message: 'no cmd provided to parser', value: null });
    return { cmd: '', profile: null, named, positional, errors, missing_required };
  }

  let spec;
  try { spec = registryLook(cmd); }
  catch (cause) {
    if (cause instanceof CamoError) {
      errors.push({ field: 'cmd', message: cause.code, value: cmd });
    } else {
      errors.push({ field: 'cmd', message: 'unknown error', value: cmd });
    }
    return { cmd, profile: null, named, positional, errors, missing_required };
  }

  const args = Array.isArray(argv) ? argv.slice() : [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!looksLikeFlag(a)) {
      positional.push(a);
      continue;
    }
    const key = a.slice(2);
    if (key === 'help' || key === 'h') {
      return { cmd, profile: null, named, positional, errors, missing_required, help: true };
    }
    const eq = key.indexOf('=');
    let k; let v;
    if (eq >= 0) {
      k = key.slice(0, eq);
      v = key.slice(eq + 1);
    } else {
      k = key;
      const next = args[i + 1];
      if (next === undefined || looksLikeFlag(next)) {
        v = 'true'; // boolean flag default
      } else {
        v = next;
        i += 1;
      }
    }
    named[k] = v;
  }

  const out = { cmd, profile: null, named, positional, errors, missing_required };

  // Apply schema validation to named.
  for (const [field, sub] of Object.entries(spec.args_schema.named || {})) {
    const r = coerceNamed(field, sub, named[field]);
    if (!r.ok) {
      out.errors.push(r.error);
    } else {
      out.named[field] = r.value;
    }
  }

  // Apply positional validation.
  const posSchema = spec.args_schema.positional || [];
  for (let i = 0; i < posSchema.length; i += 1) {
    const ps = posSchema[i];
    const v = positional[i];
    if (v === undefined) {
      if (ps.required) out.missing_required.push({ positional_index: i, name: ps.name });
      continue;
    }
    if (ps.type === 'string') {
      if (typeof v !== 'string') out.errors.push({ field: `positional[${i}]`, message: 'must be string', value: v });
      if (ps.pattern && !new RegExp(ps.pattern).test(String(v))) {
        out.errors.push({ field: `positional[${i}]`, message: `must match ${ps.pattern}`, value: v });
      }
    }
  }
  if (positional.length > posSchema.length) {
    out.errors.push({ field: 'positional', message: `too many positional args (got ${positional.length}, max ${posSchema.length})`, value: positional.slice(posSchema.length) });
  }

  // Default profile: explicit named > $CAMO_PROFILE > 'default'
  if (out.named.profile == null) {
    const env = (process.env.CAMO_PROFILE || 'default').trim() || 'default';
    out.profile = env;
  } else {
    out.profile = out.named.profile;
  }

  return out;
}

// infer(argv, registry?) -> the FIRST token of argv becomes the cmd.
// We deliberately do NOT consume the cmd token; shell.cli chains
// parse(argvRest, { cmd: token }).
export function infer(argv, _registry) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const first = String(argv[0] || '');
  if (!first || first.startsWith('--')) return null;
  return registryHas(first) ? first : null;
}
