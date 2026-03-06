import fs from 'fs';
import path from 'path';
import { resolveRecordsRoot } from '../storage-paths.js';
export class BrowserSessionRecording {
    profileId;
    getCurrentUrl;
    getContext;
    recordingStream = null;
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
    bindRecorderBridge = () => { };
    installRecorderRuntime = async () => { };
    constructor(profileId, getCurrentUrl, getContext) {
        this.profileId = profileId;
        this.getCurrentUrl = getCurrentUrl;
        this.getContext = getContext;
    }
    setBindRecorderBridge(fn) {
        this.bindRecorderBridge = fn;
    }
    setInstallRecorderRuntime(fn) {
        this.installRecorderRuntime = fn;
    }
    getRecordingStatus() {
        return { ...this.recording };
    }
    normalizeRecordingName(raw) {
        const text = String(raw || '').trim();
        const fallback = `record-${this.profileId}`;
        if (!text)
            return fallback;
        return text.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || fallback;
    }
    buildRecordingFilename(name) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${stamp}-${name}.jsonl`;
    }
    resolveRecordingOutputPath(options) {
        const name = this.normalizeRecordingName(options?.name);
        const rawOutput = String(options?.outputPath || '').trim();
        if (!rawOutput) {
            const root = path.join(resolveRecordsRoot(), this.profileId);
            return path.join(root, this.buildRecordingFilename(name));
        }
        const absolute = path.isAbsolute(rawOutput) ? rawOutput : path.resolve(rawOutput);
        if (absolute.endsWith(path.sep)) {
            return path.join(absolute, this.buildRecordingFilename(name));
        }
        if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
            return path.join(absolute, this.buildRecordingFilename(name));
        }
        return absolute;
    }
    async startRecording(options = {}) {
        const outputPath = this.resolveRecordingOutputPath(options);
        const name = this.normalizeRecordingName(options?.name);
        const overlay = options?.overlay !== false;
        if (this.recordingStream) {
            await this.stopRecording({ reason: 'restart' });
        }
        await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
        const stream = fs.createWriteStream(outputPath, { flags: 'a', encoding: 'utf-8' });
        stream.on('error', (err) => {
            this.recording.lastError = err?.message || String(err);
            this.recording.enabled = false;
        });
        this.recordingStream = stream;
        this.recording = {
            active: true,
            enabled: true,
            name,
            outputPath,
            overlay,
            startedAt: Date.now(),
            endedAt: null,
            eventCount: 0,
            lastEventAt: null,
            lastError: null,
        };
        const context = this.getContext();
        if (context) {
            const pages = context.pages().filter((p) => !p.isClosed());
            for (const page of pages) {
                this.bindRecorderBridge(page);
                // eslint-disable-next-line no-await-in-loop
                await this.installRecorderRuntime(page, 'recording_start').catch(() => { });
            }
        }
        this.writeRecordingEvent('recording.start', { name, outputPath, overlay }, { allowWhenDisabled: true });
        return this.getRecordingStatus();
    }
    async stopRecording(options = {}) {
        if (!this.recordingStream) {
            this.recording.active = false;
            this.recording.enabled = false;
            this.recording.overlay = false;
            this.recording.endedAt = Date.now();
            const context = this.getContext();
            if (context) {
                const pages = context.pages().filter((p) => !p.isClosed());
                for (const page of pages) {
                    // eslint-disable-next-line no-await-in-loop
                    await this.destroyRecorderRuntimeOnPage(page).catch(() => { });
                }
            }
            return this.getRecordingStatus();
        }
        this.writeRecordingEvent('recording.stop', { reason: options.reason || 'manual' }, { allowWhenDisabled: true });
        this.recording.enabled = false;
        this.recording.active = false;
        this.recording.overlay = false;
        this.recording.endedAt = Date.now();
        const context = this.getContext();
        if (context) {
            const pages = context.pages().filter((p) => !p.isClosed());
            for (const page of pages) {
                // eslint-disable-next-line no-await-in-loop
                await this.destroyRecorderRuntimeOnPage(page).catch(() => { });
            }
        }
        const stream = this.recordingStream;
        this.recordingStream = null;
        await new Promise((resolve) => {
            stream.end(() => resolve());
        });
        return this.getRecordingStatus();
    }
    writeRecordingEvent(type, payload = {}, options = {}) {
        if (!this.recordingStream || !this.recording.active)
            return;
        if (!this.recording.enabled && !options.allowWhenDisabled)
            return;
        const eventTs = Date.now();
        const entry = {
            ts: eventTs,
            profileId: this.profileId,
            sessionId: this.profileId,
            type,
            url: options.pageUrl || this.getCurrentUrl() || null,
            payload,
        };
        try {
            this.recordingStream.write(`${JSON.stringify(entry)}\n`);
            this.recording.eventCount += 1;
            this.recording.lastEventAt = eventTs;
        }
        catch (err) {
            this.recording.lastError = err?.message || String(err);
        }
    }
    handleRecorderEvent(page, evt) {
        const type = String(evt?.type || '').trim();
        if (!type)
            return;
        const pageUrl = String(evt?.href || page?.url?.() || this.getCurrentUrl() || '');
        const payload = evt?.payload && typeof evt.payload === 'object' ? evt.payload : {};
        if (type === 'recording.toggled') {
            if (!this.recording.active) {
                this.recording.enabled = false;
                return;
            }
            this.recording.enabled = payload.enabled !== false;
            this.writeRecordingEvent(type, payload, { pageUrl, allowWhenDisabled: true });
            return;
        }
        if (type === 'recording.runtime_ready') {
            this.writeRecordingEvent(type, payload, { pageUrl, allowWhenDisabled: true });
            return;
        }
        this.writeRecordingEvent(type, payload, { pageUrl });
    }
    recordPageVisit(page, reason) {
        const pageUrl = page?.url?.() || this.getCurrentUrl() || null;
        if (!pageUrl)
            return;
        this.writeRecordingEvent('page.visit', { reason, title: null }, { pageUrl });
    }
    async destroyRecorderRuntimeOnPage(page) {
        if (!page || page.isClosed())
            return;
        await page.evaluate(() => {
            const runtime = window.__camoRecorderV1__;
            if (!runtime || typeof runtime.destroy !== 'function')
                return null;
            return runtime.destroy();
        });
    }
}
//# sourceMappingURL=recording.js.map