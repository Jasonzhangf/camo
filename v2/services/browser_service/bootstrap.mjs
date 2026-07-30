// Browser service bootstrap. Module id=services.browser_service.
//
// This module is the entry point for the browser-service daemon process.
// It orchestrates all L2_service truth owners and owns the Playwright lifecycle.
//
// Orchestrated modules:
//   - playwright_bridge: actual browser instance management
//   - lock: profile lock (prevents concurrent daemons on same profile)
//   - session: session registry
//   - page_runtime: tab pool + input pipeline
//   - display: display metrics resolution
//   - progress_event: event fan-out
//
// Hard guards:
//   - All browser operations go through playwright_bridge only.
//   - No v1 imports.
//   - Profile lock acquired before browser launch, released on shutdown.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { launchBrowser, closeBrowser, getPage, listActive, closeAll, __enableTestRoot as __enablePlaywrightBridge } from './internal/playwright_bridge.mjs';
import { next as nextTab, closeAll as closeAllTabs } from '../page_runtime/tab_pool.mjs';
import { append as appendProgress } from '../progress_event/log.mjs';
import { read as readProfile } from '../profile/store.mjs';
import { resolveDisplayMetrics } from '../display/resolver.mjs';

let _enabled = false;
export function __enableTestRoot() {
  if (_enabled) return;
  _enabled = true;
  // Synchronously enable downstream playwright_bridge owner.
  // Other modules are lazy-imported; their __enableTestRoot is called by
  // enableAllOwners() which the daemon awaits before serving.
  __enablePlaywrightBridge();
}

/**
 * Bring downstream owner modules into writable scope. Browser_service is the
 * single orchestrator for these sub-modules, so enabling here unblocks them
 * for the entire daemon process.
 *
 * Returns once all dynamic imports resolve and their __enableTestRoot has run,
 * so callers can `await` this before invoking browser operations.
 */
let _downstreamPromise = null;
export function enableAllOwners() {
  if (_downstreamPromise) return _downstreamPromise;
  _downstreamPromise = Promise.all([
    import('./internal/playwright_bridge.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
    import('../page_runtime/input_pipeline.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
    import('../page_runtime/tab_pool.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
    import('../session/manager.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
    import('../lock/manager.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
    import('../display/resolver.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
  ]);
  return _downstreamPromise;
}
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

// boot() returns a plan describing the startup sequence.
// This is a read-only function (no __enableTestRoot required).
export function boot({ profileId, headless, mode } = {}) {
  const pid = safeId(profileId, 'profileId');
  const m = normalizeMode(mode);
  const hl = headless === true || m === 'headless';
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

// Internal state for the daemon process
let _lockHandle = null;
let _currentProfile = null;

function emit(type, payload) {
  appendProgress({ runId: 'run-default', event: type, source: 'browser_service', payload, ts: new Date().toISOString() });
}

// --- Public API ---

/**
 * Start a browser session for the given profile.
 */
export async function startSession({ profileId, headless, mode } = {}) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');
  const m = normalizeMode(mode);
  const hl = headless === true || m === 'headless';

  emit('session.start', { profileId: pid, headless: hl, mode: m });

  // Verify profile exists, or create default metadata for ephemeral sessions
  let profileMeta;
  try {
    profileMeta = readProfile(pid);
  } catch (cause) {
    if (cause.code === 'E_STATE_NOT_FOUND') {
      // Auto-create profile for ephemeral sessions
      const { write: writeProfile } = await import('../profile/store.mjs');
      profileMeta = writeProfile(pid, {});
    } else {
      throw cause;
    }
  }

  // Import lock lazily to avoid circular dependency at module load
  const { acquire: acquireLock } = await import('../lock/manager.mjs');
  const lockOwner = `browser-service-${process.pid}`;
  _lockHandle = acquireLock(pid, { owner: lockOwner, mode: 'F' });

  // Launch browser
  const record = await launchBrowser(pid, { headless: hl });

  // Import session manager
  const { create: createSession, markClosed: markSessionClosed, tryRead: tryReadSession } = await import('../session/manager.mjs');
  
  // Create session record
  const session = createSession(pid, {
    headless: hl,
    instanceId: record.browser._id ? String(record.browser._id) : `chromium-${process.pid}`,
    metadata: { mode: m, startedAt: record.createdAt },
  });

  // Initialize tab pool
  nextTab(pid);

  // Read display metrics
  try {
    resolveDisplayMetrics();
  } catch (cause) {
    throw new CamoError({
      code: 'E_DISPLAY_RESOLVE_FAILED',
      details: { reason: cause?.message || String(cause) },
      cause,
    });
  }

  _currentProfile = pid;

  emit('session.started', { profileId: pid, sessionId: session.instanceId });

  return {
    profileId: pid,
    sessionId: session.instanceId,
    headless: hl,
    mode: m,
    startedAt: session.startedAt,
  };
}

/**
 * Stop the browser session for the given profile.
 */
export async function stopSession(profileId) {
  ensureWritable();
  const pid = safeId(profileId, 'profileId');

  emit('session.stop', { profileId: pid });

  // Close browser
  await closeBrowser(pid);

  // Delete session - ephemeral sessions are recreated fresh each time.
  // For persistent profiles, we could use markClosed to preserve history.
  const { deleteSession: deleteSession, tryRead: tryReadSession } = await import('../session/manager.mjs');
  const session = tryReadSession(pid);
  if (session) {
    deleteSession(pid);
  }

  // Release lock
  if (_lockHandle) {
    const { release: releaseLock } = await import('../lock/manager.mjs');
    releaseLock(pid); // throws E_STATE_LOCKED on caller mismatch; surface to caller
    _lockHandle = null;
  }

  // Close all tabs
  closeAllTabs(pid);

  _currentProfile = null;

  emit('session.stopped', { profileId: pid });

  return { profileId: pid, stopped: true };
}

/**
 * Get the current page for a profile.
 */
export function getCurrentPage(profileId) {
  const pid = safeId(profileId, 'profileId');
  const page = getPage(pid);
  if (!page) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'page', profileId: pid } });
  }
  return page;
}

/**
 * Get session info for a profile.
 */
export async function getSession(profileId) {
  const pid = safeId(profileId, 'profileId');
  const { tryRead: tryReadSession } = await import('../session/manager.mjs');
  return tryReadSession(pid);
}

/**
 * List active browser instances.
 */
export function listSessions() {
  return listActive();
}

/**
 * Get display metrics.
 */
export function getDisplayMetrics() {
  return resolveDisplayMetrics();
}

/**
 * Shutdown all browsers and release locks.
 */
export async function shutdown() {
  ensureWritable();
  emit('browser_service.shutdown', {});
  await closeAll();
  if (_lockHandle && _currentProfile) {
    const { release: releaseLock } = await import('../lock/manager.mjs');
    releaseLock(_currentProfile); // surface mismatch to caller
    _lockHandle = null;
  }
  _currentProfile = null;
}

/**
 * Read-only module description.
 */
export function describe() {
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

/**
 * Reset for testing.
 */
export async function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _lockHandle = null;
  _currentProfile = null;
  closeAllTabs();
  await closeAll();
}
