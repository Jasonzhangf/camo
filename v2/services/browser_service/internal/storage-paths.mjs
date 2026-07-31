// Storage paths. Module id=services.browser_service.internal.storage_paths.
//
// Single source of truth for all camo data directories.
// Respects env overrides: CAMO_PORTABLE_ROOT, CAMO_ROOT, CAMO_PATHS_*.

import os from 'node:os';
import path from 'node:path';

function resolveHomeDir() {
    const envHome = process.platform === 'win32'
        ? String(process.env.USERPROFILE || '').trim()
        : String(process.env.HOME || '').trim();
    return envHome || os.homedir();
}

function resolvePortableRoot() {
    return String(process.env.CAMO_PORTABLE_ROOT || process.env.CAMO_ROOT || '').trim();
}

function resolveDataRoot() {
    const portableRoot = resolvePortableRoot();
    if (portableRoot) return path.join(portableRoot, '.camo');
    return path.join(resolveHomeDir(), '.camo');
}

export function resolveProfilesRoot() {
    const envRoot = String(process.env.CAMO_PATHS_PROFILES || '').trim();
    if (envRoot) return envRoot;
    return path.join(resolveDataRoot(), 'profiles');
}

export function resolveCookiesRoot() {
    const envRoot = String(process.env.CAMO_PATHS_COOKIES || '').trim();
    if (envRoot) return envRoot;
    return path.join(resolveDataRoot(), 'cookies');
}

export function resolveLocksRoot() {
    const envRoot = String(process.env.CAMO_PATHS_LOCKS || '').trim();
    if (envRoot) return envRoot;
    return path.join(resolveDataRoot(), 'locks');
}

export function resolveRecordsRoot() {
    const envRoot = String(process.env.CAMO_PATHS_RECORDS || '').trim();
    if (envRoot) return envRoot;
    return path.join(resolveDataRoot(), 'records');
}
