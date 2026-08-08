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

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { launchEngineContext } from './engine-manager.mjs';
import { loadOrGenerateFingerprint, applyFingerprint } from './fingerprint.mjs';
import { ProfileLock } from './ProfileLock.mjs';
import { resolveProfilesRoot } from './storage-paths.mjs';

const _records = new Map();  // profileId -> { context, browser, page, lock, fingerprint, createdAt }
let _enabled = false;

export function __enableTestRoot() { _enabled = true; }

function ensureWritable() {
    if (!_enabled) {
        throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'camoufox_bridge.write', reason: 'not in writable scope' } });
    }
}

function profileDir(profileId) {
    return path.join(resolveProfilesRoot(), String(profileId || '').trim());
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
    const fingerprint = await loadOrGenerateFingerprint(pid, {
        platform: opts.fingerprintPlatform || null,
    });

    // Acquire profile lock
    const lock = new ProfileLock(pid);
    if (!lock.acquire()) {
        throw new CamoError({ code: 'E_STATE_LOCKED', details: { resource: 'profile', profileId: pid } });
    }

    // Launch Camoufox context
    const fallbackViewport = { width: 1440, height: 1100 };
    const explicitViewport = opts.viewport
        && Number(opts.viewport.width) > 0
        && Number(opts.viewport.height) > 0
        ? { width: Math.floor(Number(opts.viewport.width)), height: Math.floor(Number(opts.viewport.height)) }
        : null;
    const viewport = explicitViewport || fingerprint?.viewport || fallbackViewport;

    let context;
    try {
        context = await launchEngineContext({
            engine: 'camoufox',
            headless,
            profileDir: profileDir(pid),
            viewport,
            userAgent: fingerprint?.userAgent,
            locale: fingerprint?.language || 'zh-CN',
            timezoneId: fingerprint?.timezoneId || 'Asia/Shanghai',
        });
    } catch (cause) {
        lock.release();
        throw new CamoError({
            code: 'E_BROWSER_LAUNCH_FAILED',
            details: { profileId: pid, reason: cause?.message || String(cause) },
            cause,
        });
    }

    // Apply fingerprint JS overrides
    await applyFingerprint(context, fingerprint);

    // Get or create page
    const existing = context.pages();
    let page = existing.length ? existing[0] : await context.newPage();

    const browser = context.browser();

    const record = {
        context,
        browser,
        page,
        lock,
        fingerprint,
        createdAt: new Date().toISOString(),
        profileId: pid,
        headless,
    };

    _records.set(pid, record);
    return record;
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
        console.error(`closeBrowser(${pid}): ${cause?.message || cause}`);
    }

    record.lock.release();
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
 * Switch the active page for a profile to the tab at the given index.
 * tabId is the zero-based index into context.pages() (same as listTabs).
 * Protocol-level: brings the target tab to front and updates the active
 * page handle so subsequent operations target it.
 */
export async function switchPage(profileId, tabId) {
    ensureWritable();
    const pid = String(profileId || '').trim();
    if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
    const record = _records.get(pid);
    if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
    const pages = record.context.pages();
    const idx = Number(tabId);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) {
        throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'tabId', value: tabId, available: pages.length } });
    }
    const target = pages[idx];
    await target.bringToFront();
    record.page = target;
    return { profileId: pid, tabId: idx, url: target.url() };
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
}
