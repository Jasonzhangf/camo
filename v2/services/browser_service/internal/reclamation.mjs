// Pending cleanup and reclamation projection for the browser service.

const _pendingCleanups = [];

export function recordPendingCleanup(profileId, kind, error, targetPath = null) {
    _pendingCleanups.push({
        kind,
        profileId,
        path: targetPath,
        error: error?.message || String(error),
        at: new Date().toISOString(),
    });
}

export function listPendingCleanups() {
    return _pendingCleanups.slice();
}

export function clearPendingCleanupsForTest() {
    _pendingCleanups.length = 0;
}

export async function listReclamation() {
    const { listStale } = await import('../../lock/manager.mjs');
    const { listStaleRegistrations } = await import('../../daemon_registration/registry.mjs');
    const staleRegistrations = listStaleRegistrations().map((registration) => ({
        daemonId: registration.daemonId,
        pid: registration.pid,
        startedAt: registration.startedAt,
    }));
    return {
        idleTimeoutMs: null,
        pending: listPendingCleanups(),
        staleLocks: listStale(),
        staleRegistrations,
    };
}
