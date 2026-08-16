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
import fs from 'node:fs';
import {
    launchBrowser,
    closeBrowser,
    getPage,
    listActive,
    closeAll,
    __enableTestRoot as __enableCamoufoxBridge,
} from './internal/camoufox_bridge.mjs';
import { append as appendProgress } from '../progress_event/log.mjs';
import { read as readProfile, write as writeProfile, deleteProfile as deleteProfileMeta } from '../profile/store.mjs';
import { resolveDisplayMetrics } from '../display/resolver.mjs';
import { resolveProfileDir, resolveEphemeralTempDirName } from './internal/storage-paths.mjs';

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
const _lockHandles = new Map();
const _ephemeralProfiles = new Map();   // allocatedName -> { pid, ts, startedAt }

export const TEMP_PROFILE_ALIAS = 'temp';
const EPHEMERAL_PREFIX = '_temp_';

function isEphemeralAllocated(profileId) {
    return typeof profileId === 'string' && profileId.startsWith(EPHEMERAL_PREFIX);
}

export function ephemeralProfileDirFor(profileId) {
    return resolveProfileDir(profileId);
}

function allocateEphemeralProfileId() {
    return resolveEphemeralTempDirName(process.pid, Date.now());
}

function safeAllocatedEphemeralId(id) {
    if (!isEphemeralAllocated(id)) {
        throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id, reason: 'not an ephemeral temp id' } });
    }
    return id;
}

function lockOwner() {
    return `browser-service-${process.pid}`;
}

function emit(type, payload) {
    appendProgress({ runId: 'run-default', event: type, source: 'browser_service', payload, ts: new Date().toISOString() });
}

export async function startSession({ profileId, headless, mode, viewport, ephemeral = false } = {}) {
    ensureWritable();
    const requested = safeId(profileId, 'profileId');

    let pid = requested;
    let effectiveEphemeral = ephemeral;
    if (requested === TEMP_PROFILE_ALIAS) {
        pid = allocateEphemeralProfileId();
        effectiveEphemeral = true;
    } else if (ephemeral && !isEphemeralAllocated(pid)) {
        pid = allocateEphemeralProfileId();
    }
    if (effectiveEphemeral && !isEphemeralAllocated(pid)) {
        throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', reason: 'ephemeral requires temp alias or allocated id' } });
    }

    const m = normalizeMode(mode);
    const hl = headless === true || m === 'headless';

    emit('session.start', { profileId: pid, headless: hl, mode: m, ephemeral: effectiveEphemeral });

    // Ensure profile metadata exists (auto-create for ephemeral)
    let profileMeta;
    let profileCreated = false;
    try {
        profileMeta = readProfile(pid);
    } catch (cause) {
        if (cause.code === 'E_STATE_NOT_FOUND') {
            profileMeta = writeProfile(pid, {});
            profileCreated = true;
        } else {
            throw cause;
        }
    }

    // Acquire CLI-facing lock
    const { acquire: acquireLock } = await import('../lock/manager.mjs');
    const lockHandle = acquireLock(pid, { owner: lockOwner(), pid: process.pid, mode: 'F' });
    _lockHandles.set(pid, lockHandle);

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
        _lockHandles.delete(pid);
        if (profileCreated) {
            deleteProfileMeta(pid);
        }
        throw cause;
    }

    if (effectiveEphemeral) {
        _ephemeralProfiles.set(pid, { pid: process.pid, ts: Date.now(), startedAt: new Date().toISOString() });
    }

    // Create session record
    const { create: createSession, deleteSession: deleteSession, tryRead: tryReadSession } = await import('../session/manager.mjs');
    const session = createSession(pid, {
        headless: hl,
        instanceId: `camoufox-${process.pid}`,
        ephemeral: effectiveEphemeral,
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

    emit('session.started', { profileId: pid, sessionId: session.instanceId, engine: 'camoufox', ephemeral: effectiveEphemeral });

    return {
        profileId: pid,
        sessionId: session.instanceId,
        headless: hl,
        mode: m,
        engine: 'camoufox',
        ephemeral: effectiveEphemeral,
        startedAt: session.startedAt,
    };
}

export async function stopSession(profileId) {
    ensureWritable();
    const pid = safeId(profileId, 'profileId');

    emit('session.stop', { profileId: pid });

    const wasEphemeral = _ephemeralProfiles.has(pid);

    await closeBrowser(pid);

    const { deleteSession: deleteSession, tryRead: tryReadSession } = await import('../session/manager.mjs');
    if (tryReadSession(pid)) deleteSession(pid);

    if (_lockHandles.has(pid)) {
        const { release: releaseLock } = await import('../lock/manager.mjs');
        releaseLock(pid, { owner: lockOwner(), pid: process.pid });
        _lockHandles.delete(pid);
    }

    const tabPoolMod2 = await import('../../services/page_runtime/tab_pool.mjs');
    tabPoolMod2.closeAll(pid);

    emit('session.stopped', { profileId: pid, ephemeral: wasEphemeral });

    if (wasEphemeral) {
        const dir = ephemeralProfileDirFor(pid);
        try {
            if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
        } catch (cause) {
            console.warn(`stopSession: failed to remove ephemeral dir ${dir}:`, cause?.message || cause);
        }
        _ephemeralProfiles.delete(pid);
        try { deleteProfileMeta(pid); } catch {}
    }

    return { profileId: pid, stopped: true, ephemeral: wasEphemeral };
}

export function listEphemeralProfiles() {
    return [..._ephemeralProfiles.keys()];
}

export function sweepStaleEphemeralProfiles() {
    if (_ephemeralProfiles.size === 0) return { swept: [] };
    const swept = [];
    for (const pid of _ephemeralProfiles.keys()) {
        const dir = ephemeralProfileDirFor(pid);
        try {
            if (fs.existsSync(dir)) {
                fs.rmSync(dir, { recursive: true, force: true });
                swept.push(pid);
            }
        } catch (cause) {
            console.warn(`sweepStaleEphemeralProfiles: failed ${dir}:`, cause?.message || cause);
        }
        _ephemeralProfiles.delete(pid);
        try { deleteProfileMeta(pid); } catch {}
    }
    return { swept };
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

export function hasBrowser(profileId) {
    const pid = safeId(profileId, 'profileId');
    return listActive().includes(pid);
}

export function getDisplayMetrics() {
    return resolveDisplayMetrics();
}

export async function shutdown() {
    ensureWritable();
    emit('browser_service.shutdown', {});
    await closeAll();
    sweepStaleEphemeralProfiles();
    if (_lockHandles.size > 0) {
        const { release: releaseLock } = await import('../lock/manager.mjs');
        for (const profileId of [..._lockHandles.keys()]) releaseLock(profileId, { owner: lockOwner(), pid: process.pid });
        _lockHandles.clear();
    }
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
    _lockHandles.clear();
    _ephemeralProfiles.clear();
    await closeAll();
}

export function __setOwnedProfilesForTest(profileIds) {
    if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setOwnedProfilesForTest' } });
    _lockHandles.clear();
    for (const profileId of profileIds || []) {
        _lockHandles.set(String(profileId), { profileId: String(profileId) });
    }
}
