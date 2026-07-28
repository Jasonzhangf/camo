// Display metrics resolver. Single truth_owner for resource_id=display_metrics.
//
// Resolution priority (highest to lowest):
//   1. Test screen override (only active when __enableTestRoot has been
//      called AND width/height are non-null).
//   2. Env override (CAMO_SCREEN_WIDTH + CAMO_SCREEN_HEIGHT).
//   3. Platform provider (darwin/win32) — returns null when the platform
//      has no usable metrics, which then falls through to defaults.
//   4. Built-in default (1920x1080).
//
// The resolver is async because the platform provider may use osascript
// / PowerShell via spawnSync or future async probes. Callers should
// `await resolve()`.
//
// Hard guards:
//   - Single owner (no duplicates). v1 had 3 copies (browser-service
//     index.js, engine-manager.js, process-cleanup.js); v2 has one.
//   - No fallback to v1 osascript paths.
//   - Provider errors are projected through error_envelope.

import os from 'node:os';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

let _testRoot = false;
let _override = { width: null, height: null };
let _provider = null;

export function __enableTestRoot() { _testRoot = true; }
export function __setScreenForTest({ width, height }) {
  if (!_testRoot) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setScreenForTest' } });
  }
  _override = {
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
  };
}
export function __setPlatformProviderForTest(fn) {
  if (!_testRoot) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setPlatformProviderForTest' } });
  }
  _provider = typeof fn === 'function' ? fn : null;
}
export function __resetForTest() {
  _testRoot = false;
  _override = { width: null, height: null };
  _provider = null;
}

function readEnv() {
  const w = Number(process.env.CAMO_SCREEN_WIDTH);
  const h = Number(process.env.CAMO_SCREEN_HEIGHT);
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    return { width: w, height: h, source: 'env' };
  }
  return null;
}

function readOverride() {
  if (_override.width && _override.height) {
    return { width: _override.width, height: _override.height, source: 'test' };
  }
  return null;
}

async function readProvider(platform) {
  if (typeof _provider === 'function') {
    try {
      const out = await _provider({ platform: platform || os.platform() });
      if (out && Number.isFinite(out.width) && Number.isFinite(out.height) && out.width > 0 && out.height > 0) {
        return {
          width: out.width,
          height: out.height,
          workWidth: Number.isFinite(out.workWidth) ? out.workWidth : undefined,
          workHeight: Number.isFinite(out.workHeight) ? out.workHeight : undefined,
          source: out.source || 'platform',
        };
      }
      return null;
    } catch (cause) {
      if (cause instanceof CamoError) throw cause;
      throw new CamoError({ code: 'E_IO_FILESYSTEM', details: { op: 'platform_provider' }, cause });
    }
  }
  return null;
}

export async function resolve(opts = {}) {
  const o = readOverride();
  if (o) return o;
  const env = readEnv();
  if (env) return env;
  const plat = await readProvider(opts.platform);
  if (plat) return plat;
  // A registered provider that returned null/invalid means "no metrics
  // available on this host". Do not silently fall back to a default
  // size; let the caller decide.
  if (typeof _provider === 'function') return null;
  return { width: 1920, height: 1080, source: 'default' };
}

// Synchronous accessor used by callers that only need the cache.
// Tests should prefer await resolve(); production callers may use this
// after the first await resolve() warms the cache.
let _cache = null;
export function resolveDisplayMetrics() {
  if (_cache) return _cache;
  // Best-effort sync: try env, then test override, then default.
  const o = readOverride();
  if (o) { _cache = o; return _cache; }
  const env = readEnv();
  if (env) { _cache = env; return _cache; }
  _cache = { width: 1920, height: 1080, source: 'default' };
  return _cache;
}

export function clearCache() { _cache = null; }
