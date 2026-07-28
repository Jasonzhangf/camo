// Browser service bootstrap. Single entry for module_id=services.browser_service.
//
// This module is a thin orchestrator. It does NOT own any single
// resource by itself; it composes the L2_service truth owners:
//
//   lock           -> services.lock
//   session        -> services.session
//   page_runtime   -> services.page_runtime (tab_pool + input_pipeline)
//   display        -> services.display
//   autoscript     -> services.autoscript + actions
//   subscription   -> services.subscription
//
// Hard guards:
//   - Reads only the canonical API of each service. No v1 imports.
//   - No fallback to v1 browser-service/index.js or engine-manager.js.
//   - In test mode (no daemon present), boot is dry-run by default and
//     returns a manifest describing the desired state.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';

let _enabled = false;
export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'browser_service.write', reason: 'bootstrap not in writable scope' } });
  }
}

const ALLOWED_MODES = new Set(['foreground', 'background', 'headless']);

function normalizeMode(mode) {
  const m = String(mode || '').trim().toLowerCase();
  if (!m) return 'background';
  if (!ALLOWED_MODES.has(m)) {
    throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'mode', value: mode, allowed: [...ALLOWED_MODES] } });
  }
  return m;
}

function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

// boot() loads the canonical service modules and returns a manifest.
// The actual side effects (lock.acquire, session.create, ...) live in
// browser_service/internal/wiring.mjs in a later stage. For now we
// expose boot() that returns a plan only.
export function boot({ profileId, mode, headless } = {}) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const m = normalizeMode(mode);
  const hl = headless === true;
  return {
    profileId: pid,
    mode: m,
    headless: hl,
    steps: [
      { id: 'lock.acquire',    target: 'services/lock/manager.mjs' },
      { id: 'session.create',  target: 'services/session/manager.mjs' },
      { id: 'tab_pool.ensure', target: 'services/page_runtime/tab_pool.mjs' },
      { id: 'display.read',    target: 'services/display/resolver.mjs' },
      { id: 'autoscript.start',target: 'services/autoscript/runner.mjs' },
    ],
    startedAt: new Date().toISOString(),
    dryRun: true,
  };
}

export function describe() {
  // Read-only; usable without __enableTestRoot because it returns the
  // module manifest, not anything stateful.
  return {
    moduleId: 'services.browser_service',
    layer: 'L2_service',
    role: 'orchestrator',
    owner_for: [
      'services.lock',
      'services.session',
      'services.page_runtime',
      'services.display',
      'services.autoscript',
      'services.subscription',
    ],
  };
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  // No state to reset; orchestrator is stateless.
}
