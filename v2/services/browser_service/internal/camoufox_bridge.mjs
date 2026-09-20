// Camoufox bridge. Module id=services.browser_service.internal.camoufox_bridge.
//
// Single truth_owner for the Camoufox (Firefox) browser instance per profileId.
// All browser calls MUST go through here — no direct camoufox imports elsewhere in v2.
//
// Hard guards:
//   - Only Camoufox engine; Chromium removed.
//   - One browser instance per profileId.
//   - Graceful SIGTERM handling.
//   - No fallback; Camoufox unavailable = fatal error.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { launchEngineContext } from './engine-manager.mjs';
import { loadOrGenerateFingerprint, applyFingerprint } from './fingerprint.mjs';
import { resolveProfileDir } from './storage-paths.mjs';

const _records = new Map();  // profileId -> { context, browser, page, fingerprint, createdAt }
let _enabled = false;
let launchEngineContextOwner = launchEngineContext;
let loadOrGenerateFingerprintOwner = loadOrGenerateFingerprint;
let applyFingerprintOwner = applyFingerprint;

export function __enableTestRoot() { _enabled = true; }

function ensureWritable() {
    if (!_enabled) {
        throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'camoufox_bridge.write', reason: 'not in writable scope' } });
    }
}

function profileDir(profileId) {
    return resolveProfileDir(profileId);
}

/**
 * Launch Camoufox for a profile.
 * Returns { context, browser, page, fingerprint, createdAt }
 */
export async function launchBrowser(profileId, opts = {}) {
    ensureWritable();
    const pid = String(profileId || '').trim();
    if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });

    if (_records.has(pid)) {
        throw new CamoError({
            code: 'E_STATE_DUPLICATE',
            details: { resource: 'browser_instance', profileId: pid, op: 'launchBrowser.duplicate' },
        });
    }

    const headless = opts.headless ?? false;

    // Load/generate fingerprint
    const fingerprint = await loadOrGenerateFingerprintOwner(pid, {
        platform: opts.fingerprintPlatform || null,
    });

    // Launch Camoufox context
    const fallbackViewport = { width: 1440, height: 1100 };
    const explicitViewport = opts.viewport
        && Number(opts.viewport.width) > 0
        && Number(opts.viewport.height) > 0
        ? { width: Math.floor(Number(opts.viewport.width)), height: Math.floor(Number(opts.viewport.height)) }
        : null;
    const viewport = explicitViewport || fingerprint?.viewport || fallbackViewport;
    const effectiveFingerprint = opts.userAgent
        ? { ...fingerprint, userAgent: opts.userAgent }
        : fingerprint;

    let context;
    try {
        context = await launchEngineContextOwner({
            engine: 'camoufox',
            headless,
            profileDir: profileDir(pid),
            viewport,
            userAgent: effectiveFingerprint?.userAgent,
            locale: effectiveFingerprint?.language || 'zh-CN',
            timezoneId: effectiveFingerprint?.timezoneId || 'Asia/Shanghai',
        });    } catch (cause) {
        throw new CamoError({
            code: 'E_BROWSER_LAUNCH_FAILED',
            details: { profileId: pid, reason: cause?.message || String(cause) },
            cause,
        });
    }

    // Apply fingerprint JS overrides
    await applyFingerprintOwner(context, effectiveFingerprint);

    // Get or create page
    const existing = context.pages();
    let page = existing.length ? existing[0] : await context.newPage();

    const browser = context.browser();

    const record = {
        context,
        browser,
        page,
        fingerprint: effectiveFingerprint,
        createdAt: new Date().toISOString(),
        profileId: pid,
        headless,
    };

    _records.set(pid, record);
    return record;
}

/**
 * Reopen one persistent profile with a session-local user-agent override.
 * The profile directory is reused so its cookies remain persistent.
 */
export async function relaunchBrowser(profileId, opts = {}) {
    ensureWritable();
    const pid = String(profileId || '').trim();
    if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
    if (!opts.userAgent || typeof opts.userAgent !== 'string') {
        throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'userAgent' } });
    }

    const current = _records.get(pid);
    if (!current) {
        throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
    }
    const currentUrl = typeof current.page?.url === 'function' ? current.page.url() : 'about:blank';
    const currentViewport = typeof current.page?.viewportSize === 'function'
        ? current.page.viewportSize()
        : null;
    const headless = current.headless === true;

    try {
        await current.context.close();
    } catch (cause) {
        _records.delete(pid);
        throw new CamoError({
            code: 'E_BROWSER_RELAUNCH_FAILED',
            details: { profileId: pid, phase: 'close', reason: cause?.message || String(cause) },
            cause,
        });
    }
    _records.delete(pid);

    try {
        const next = await launchBrowser(pid, {
            ...opts,
            headless,
            viewport: currentViewport || opts.viewport,
        });
        if (currentViewport && typeof next.page?.setViewportSize === 'function') {
            await next.page.setViewportSize(currentViewport);
        }
        if (currentUrl && currentUrl !== 'about:blank' && typeof next.page?.goto === 'function') {
            await next.page.goto(currentUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        return { ...next, restoredUrl: currentUrl, restoredViewport: currentViewport };
    } catch (cause) {
        const active = _records.get(pid);
        if (active) {
            try { await active.context.close(); } catch {}
            _records.delete(pid);
        }
        if (cause?.code === 'E_BROWSER_RELAUNCH_FAILED') throw cause;
        throw new CamoError({
            code: 'E_BROWSER_RELAUNCH_FAILED',
            details: { profileId: pid, phase: 'launch-or-restore', reason: cause?.message || String(cause) },
            cause,
        });
    }
}

/**
 * Close the browser for a profile.
 */
export async function closeBrowser(profileId) {
    ensureWritable();
    const pid = String(profileId || '').trim();
    if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });

    const record = _records.get(pid);
    if (!record) return false;

    try {
        await record.context.close();
    } catch (cause) {
        throw new CamoError({
            code: 'E_BROWSER_CLOSE_FAILED',
            details: { profileId: pid, reason: cause?.message || String(cause) },
            cause,
        });
    }

    _records.delete(pid);
    return true;
}

/**
 * Get the active page for a profile.
 */
export function getPage(profileId) {
    const pid = String(profileId || '').trim();
    const record = _records.get(pid);
    return record ? record.page : null;
}

/**
 * Get the full record for a profile.
 */
export function getBrowser(profileId) {
    return getRecord(profileId);
}

export function getRecord(profileId) {
    const pid = String(profileId || '').trim();
    return _records.get(pid) || null;
}

/**
 * Get the active context for a profile.
 */
export function getContext(profileId) {
    const pid = String(profileId || '').trim();
    const record = _records.get(pid);
    return record ? record.context : null;
}

export function __setBrowserForTest(profileId, record) {
    if (!_enabled) {
        throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setBrowserForTest', reason: 'not in writable scope' } });
    }
    const pid = String(profileId || '').trim();
    if (!pid) {
        throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
    }
    _records.set(pid, { profileId: pid, ...record });
}

/**
 * List all active profile IDs.
 */
export function listActive() {
    return [..._records.keys()].sort();
}

/**
 * Close all browsers and release locks.
 */
export async function closeAll() {
    const ids = [..._records.keys()];
    const failures = [];
    for (const id of ids) {
        try { await closeBrowser(id); }
        catch (cause) { failures.push({ profileId: id, error: String(cause) }); }
    }
    if (failures.length > 0) {
        throw new CamoError({ code: 'E_BROWSER_SHUTDOWN_PARTIAL', details: { failures } });
    }
}

export function __resetForTest() {
    if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
    _records.clear();
    launchEngineContextOwner = launchEngineContext;
    loadOrGenerateFingerprintOwner = loadOrGenerateFingerprint;
    applyFingerprintOwner = applyFingerprint;
}

export function __setLaunchOwnersForTest({ launch, loadFingerprint, apply } = {}) {
    if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__setLaunchOwnersForTest' } });
    launchEngineContextOwner = launch || launchEngineContext;
    loadOrGenerateFingerprintOwner = loadFingerprint || loadOrGenerateFingerprint;
    applyFingerprintOwner = apply || applyFingerprint;
}
