import { BrowserSession } from './BrowserSession.js';
export const SESSION_CLOSED_EVENT = 'browser-service:session-closed';
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export class SessionManager {
    sessions = new Map();
    // Track owning process (e.g. script pid) and bind browser lifetime to it.
    owners = new Map();
    sessionFactory;
    ownerWatchdog;
    ownerWatchdogBusy = false;
    debugLog(label, data) {
        if (process.env.DEBUG !== '1' && process.env.CAMO_DEBUG !== '1' && process.env.CAMO_DEBUG !== '1')
            return;
        try {
            console.log(`[browser-service:${label}] ${JSON.stringify(data)}`);
        }
        catch {
            console.log(`[browser-service:${label}]`, data);
        }
    }
    // Optional options are currently not used, but allowed for future extensions
    constructor(_options, sessionFactory) {
        this.sessionFactory = sessionFactory || ((opts) => new BrowserSession(opts));
        const watchdogMs = Math.max(1000, Number(_options?.ownerWatchdogMs || 5000));
        this.ownerWatchdog = setInterval(() => {
            void this.reapDeadOwners();
        }, watchdogMs);
        this.ownerWatchdog.unref?.();
    }
    normalizeOwnerPid(value) {
        const pid = Number(value || 0);
        return Number.isFinite(pid) && pid > 0 ? pid : null;
    }
    bindOwner(profileId, pid) {
        if (!pid)
            return;
        this.owners.set(profileId, { pid, startedAt: new Date().toISOString() });
    }
    async reapDeadOwners() {
        if (this.ownerWatchdogBusy)
            return;
        this.ownerWatchdogBusy = true;
        try {
            for (const [profileId, owner] of this.owners.entries()) {
                if (!owner?.pid)
                    continue;
                if (isProcessAlive(owner.pid))
                    continue;
                this.debugLog('owner:dead_cleanup', { profileId, deadPid: owner.pid });
                await this.deleteSession(profileId).catch((err) => {
                    this.debugLog('owner:dead_cleanup_error', {
                        profileId,
                        deadPid: owner.pid,
                        error: err?.message || err,
                    });
                });
            }
        }
        finally {
            this.ownerWatchdogBusy = false;
        }
    }
    async createSession(options) {
        const profileId = options.profileId || options.sessionId || `session_${Date.now().toString(36)}`;
        options.profileId = profileId;
        if (!options.sessionName) {
            options.sessionName = profileId;
        }
        this.debugLog('createSession:start', {
            profileId,
            headless: options.headless,
            hasInitialUrl: Boolean(options.initialUrl),
            ownerPid: Number(options.ownerPid || 0) || null,
        });
        const existing = this.sessions.get(profileId);
        const ownerPid = this.normalizeOwnerPid(options.ownerPid);
        if (existing) {
            const owner = this.owners.get(profileId);
            if (owner?.pid && !isProcessAlive(owner.pid)) {
                // Owner died; treat existing session as stale and replace it.
                this.debugLog('createSession:replace_stale_owner', { profileId, deadPid: owner.pid });
                await this.deleteSession(profileId);
            }
            else {
                if (ownerPid && owner?.pid && owner.pid !== ownerPid && isProcessAlive(owner.pid)) {
                    throw new Error(`session_owned_by_another_process profile=${profileId} ownerPid=${owner.pid} requesterPid=${ownerPid}`);
                }
                this.bindOwner(profileId, ownerPid);
                this.debugLog('createSession:reuse', {
                    profileId,
                    ownerPid: this.owners.get(profileId)?.pid || null,
                    requesterPid: ownerPid,
                });
                // Reuse existing session (keepalive). Do not restart the browser if it's already running.
                return { sessionId: profileId };
            }
        }
        const session = this.sessionFactory(options);
        session.onExit = (id) => {
            const current = this.sessions.get(id);
            if (current === session) {
                this.sessions.delete(id);
                // If the user closed the browser window, also terminate the owning script (if any).
                const owner = this.owners.get(id);
                if (owner?.pid) {
                    try {
                        process.kill(owner.pid, 'SIGTERM');
                    }
                    catch {
                        // ignore
                    }
                }
                this.owners.delete(id);
                process.emit(SESSION_CLOSED_EVENT, id);
            }
        };
        try {
            await session.start(options.initialUrl);
        }
        catch (err) {
            this.debugLog('createSession:start_failed', {
                profileId,
                error: err?.message || String(err),
            });
            session.onExit = undefined;
            await session.close().catch(() => { });
            throw err;
        }
        this.sessions.set(profileId, session);
        this.debugLog('createSession:started', { profileId });
        this.bindOwner(profileId, ownerPid);
        return { sessionId: profileId };
    }
    getSession(profileId) {
        this.debugLog('getSession', { profileId, hit: this.sessions.has(profileId) });
        return this.sessions.get(profileId);
    }
    listSessions() {
        return Array.from(this.sessions.values()).map((session) => ({
            profileId: session.id,
            session_id: session.id,
            current_url: session.getCurrentUrl(),
            mode: session.modeName,
            owner_pid: this.owners.get(session.id)?.pid || null,
            recording: session.getRecordingStatus(),
        }));
    }
    async getSessionInfo(profileId) {
        const session = this.getSession(profileId);
        if (!session)
            return null;
        return session.getInfo();
    }
    async deleteSession(profileId) {
        const session = this.sessions.get(profileId);
        if (!session)
            return false;
        this.debugLog('deleteSession:start', { profileId });
        session.onExit = undefined;
        await session.close();
        this.sessions.delete(profileId);
        // Deleting a session from API should NOT kill the owner (Stop=only kill script lives in UI).
        this.owners.delete(profileId);
        process.emit(SESSION_CLOSED_EVENT, profileId);
        this.debugLog('deleteSession:done', { profileId });
        return true;
    }
    async shutdown() {
        clearInterval(this.ownerWatchdog);
        const jobs = Array.from(this.sessions.values()).map((session) => session.close().catch(() => { }));
        await Promise.all(jobs);
        this.sessions.clear();
        this.owners.clear();
    }
}
//# sourceMappingURL=SessionManager.js.map
