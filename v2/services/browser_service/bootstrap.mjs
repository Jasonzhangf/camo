// Browser service bootstrap. Module id=services.browser_service.
//
// Orchestrates all L2_service truth owners and owns the Camoufox lifecycle.
// Chromium removed; Camoufox (Firefox) only.
//
// Orchestrated modules:
//   - camoufox_bridge: actual browser instance management
//   - lock: profile lock (prevents concurrent daemons on same profile)
//   - session: session registry
//   - page_runtime: tab pool + input pipeline
//   - display: display metrics resolution
//   - progress_event: event fan-out
//
// Hard guards:
//   - All browser operations go through camoufox_bridge only.
//   - No v1 imports.
//   - Profile lock acquired before browser launch, released on shutdown.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import {
    launchBrowser,
    closeBrowser,
    getPage,
    listActive,
    closeAll,
    __enableTestRoot as __enableCamoufoxBridge,
} from './internal/camoufox_bridge.mjs';
import { append as appendProgress } from '../progress_event/log.mjs';
import { read as readProfile } from '../profile/store.mjs';
import { resolveDisplayMetrics } from '../display/resolver.mjs';

let _enabled = false;
export function __enableTestRoot() {
    if (_enabled) return;
    _enabled = true;
    __enableCamoufoxBridge();
}

let _downstreamPromise = null;
export function enableAllOwners() {
    if (_downstreamPromise) return _downstreamPromise;
    _downstreamPromise = Promise.all([
        import('./internal/camoufox_bridge.mjs').then((m) => m.__enableTestRoot && m.__enableTestRoot()),
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

export function boot({ profileId, headless, mode } = {}) {
    const pid = safeId(profileId, 'profileId');
    const m = normalizeMode(mode);
    const hl = headless === true || m === 'headless';
    return {
        profileId: pid, mode: m, headless: hl,
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

// Internal state
let _lockHandle = null;
let _currentProfile = null;

function lockOwner() {
    return `browser-service-${process.pid}`;
}

function emit(type, payload) {
    appendProgress({ runId: 'run-default', event: type, source: 'browser_service', payload, ts: new Date().toISOString() });
}

export async function startSession({ profileId, headless, mode, viewport } = {}) {
    ensureWritable();
    const pid = safeId(profileId, 'profileId');
    const m = normalizeMode(mode);
    const hl = headless === true || m === 'headless';

    emit('session.start', { profileId: pid, headless: hl, mode: m });

    // Ensure profile metadata exists (auto-create for ephemeral)
    let profileMeta;
    try {
        profileMeta = readProfile(pid);
    } catch (cause) {
        if (cause.code === 'E_STATE_NOT_FOUND') {
            const { write: writeProfile } = await import('../profile/store.mjs');
            profileMeta = writeProfile(pid, {});
        } else {
            throw cause;
        }
    }

    // Acquire CLI-facing lock
    const { acquire: acquireLock } = await import('../lock/manager.mjs');
    _lockHandle = acquireLock(pid, { owner: lockOwner(), pid: process.pid, mode: 'F' });

    // Launch Camoufox
    let record;
    try {
        record = await launchBrowser(pid, {
            headless: hl,
            viewport: viewport || profileMeta.viewportSize,
            fingerprintPlatform: profileMeta.fingerprint?.platform || null,
        });
    } catch (cause) {
        const { release: releaseLock } = await import('../lock/manager.mjs');
        releaseLock(pid, { owner: lockOwner(), pid: process.pid });
        _lockHandle = null;
        throw cause;
    }

    // Create session record
    const { create: createSession, deleteSession: deleteSession, tryRead: tryReadSession } = await import('../session/manager.mjs');
    const session = createSession(pid, {
        headless: hl,
        instanceId: `camoufox-${process.pid}`,
        metadata: { mode: m, startedAt: record.createdAt, engine: 'camoufox' },
    });

    // Initialize tab pool
    const tabPoolMod = await import('../../services/page_runtime/tab_pool.mjs');
    tabPoolMod.next(pid);

    // Resolve display metrics
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
    emit('session.started', { profileId: pid, sessionId: session.instanceId, engine: 'camoufox' });

    return {
        profileId: pid,
        sessionId: session.instanceId,
        headless: hl,
        mode: m,
        engine: 'camoufox',
        startedAt: session.startedAt,
    };
}

export async function stopSession(profileId) {
    ensureWritable();
    const pid = safeId(profileId, 'profileId');

    emit('session.stop', { profileId: pid });

    await closeBrowser(pid);

    const { deleteSession: deleteSession, tryRead: tryReadSession } = await import('../session/manager.mjs');
    if (tryReadSession(pid)) deleteSession(pid);

    if (_lockHandle) {
        const { release: releaseLock } = await import('../lock/manager.mjs');
        releaseLock(pid, { owner: lockOwner(), pid: process.pid });
        _lockHandle = null;
    }

    const tabPoolMod2 = await import('../../services/page_runtime/tab_pool.mjs');
    tabPoolMod2.closeAll(pid);

    _currentProfile = null;
    emit('session.stopped', { profileId: pid });
    return { profileId: pid, stopped: true };
}

export function getCurrentPage(profileId) {
    const pid = safeId(profileId, 'profileId');
    const page = getPage(pid);
    if (!page) {
        throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'page', profileId: pid } });
    }
    return page;
}

export async function getSession(profileId) {
    const pid = safeId(profileId, 'profileId');
    const { tryRead: tryReadSession } = await import('../session/manager.mjs');
    return tryReadSession(pid);
}

export function listSessions() {
    return listActive();
}

export function getDisplayMetrics() {
    return resolveDisplayMetrics();
}

export async function shutdown() {
    ensureWritable();
    emit('browser_service.shutdown', {});
    await closeAll();
    if (_lockHandle && _currentProfile) {
        const { release: releaseLock } = await import('../lock/manager.mjs');
        releaseLock(_currentProfile, { owner: lockOwner(), pid: process.pid });
        _lockHandle = null;
    }
    _currentProfile = null;
}

export function describe() {
    return {
        moduleId: 'services.browser_service',
        layer: 'L2_service',
        role: 'orchestrator',
        owner_for: [
            'services.lock', 'services.session', 'services.page_runtime',
            'services.display', 'services.autoscript', 'services.subscription',
        ],
        engine: 'camoufox',
    };
}

export async function __resetForTest() {
    if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
    _lockHandle = null;
    _currentProfile = null;
    await closeAll();
}
