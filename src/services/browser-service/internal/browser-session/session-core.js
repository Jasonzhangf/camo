import { ProfileLock } from '../profile-lock';
import { resolveProfilesRoot } from '../paths';
export class BrowserSessionCore {
    options;
    browser;
    context;
    page;
    lock;
    profileDir;
    lastKnownUrl = null;
    mode = 'dev';
    recording = {
        active: false,
        enabled: false,
        name: null,
        outputPath: null,
        overlay: false,
        startedAt: null,
        endedAt: null,
        eventCount: 0,
        lastEventAt: null,
        lastError: null,
    };
    exitNotified = false;
    runtimeObservers = new Set();
    onExit;
    constructor(options) {
        this.options = options;
        const profileId = options.profileId || 'default';
        const root = resolveProfilesRoot();
        this.profileDir = `${root}/${profileId}`;
        fs.mkdirSync(this.profileDir, { recursive: true });
        this.lock = new ProfileLock(profileId);
    }
    get id() {
        return this.options.profileId;
    }
    get currentPage() {
        return this.page;
    }
    get modeName() {
        return this.mode;
    }
    setMode(next = 'dev') {
        this.mode = next === 'run' ? 'run' : 'dev';
    }
    getInfo() {
        return {
            session_id: this.options.profileId,
            profileId: this.options.profileId,
            current_url: this.getCurrentUrl(),
            mode: this.mode,
            headless: !!this.options.headless,
            recording: this.getRecordingStatus(),
        };
    }
    getRecordingStatus() {
        return { ...this.recording };
    }
    async close() {
        try {
            await this.stopRecording({ reason: 'session_close' }).catch(() => { });
            await this.context?.close();
        }
        finally {
            await this.browser?.close();
            this.lock.release();
            this.runtimeObservers.clear();
            this.notifyExit();
        }
    }
    notifyExit() {
        if (this.exitNotified)
            return;
        this.exitNotified = true;
        this.onExit?.(this.options.profileId);
    }
    addRuntimeEventObserver(observer) {
        this.runtimeObservers.add(observer);
        return () => {
            this.runtimeObservers.delete(observer);
        };
    }
}
//# sourceMappingURL=session-core.js.map