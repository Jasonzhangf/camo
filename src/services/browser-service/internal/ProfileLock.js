import fs from 'fs';
import path from 'path';
import os from 'os';
import { resolveLocksRoot } from './storage-paths.js';
export class ProfileLock {
    profileId;
    lockDir;
    lockFile;
    constructor(profileId, lockRoot = resolveLocksRoot()) {
        this.profileId = profileId;
        this.lockDir = lockRoot;
        fs.mkdirSync(this.lockDir, { recursive: true });
        this.lockFile = path.join(this.lockDir, `${this.profileId}.lock`);
    }
    isProcessRunning(pid) {
        try {
            process.kill(pid, 0);
            return true;
        }
        catch {
            return false;
        }
    }
    killProcess(pid) {
        try {
            process.kill(pid, 'SIGTERM');
        }
        catch { }
        const start = Date.now();
        while (Date.now() - start < 5000) {
            if (!this.isProcessRunning(pid))
                return;
        }
        try {
            process.kill(pid, 'SIGKILL');
        }
        catch { }
    }
    acquire() {
        if (fs.existsSync(this.lockFile)) {
            try {
                const raw = JSON.parse(fs.readFileSync(this.lockFile, 'utf-8'));
                const pid = Number(raw?.pid);
                if (pid && pid !== process.pid && this.isProcessRunning(pid)) {
                    this.killProcess(pid);
                }
            }
            catch {
                // ignore corrupted lock
            }
            try {
                fs.unlinkSync(this.lockFile);
            }
            catch { }
        }
        try {
            const payload = JSON.stringify({
                pid: process.pid,
                profileId: this.profileId,
                createdAt: Date.now(),
                host: os.hostname(),
            }, null, 2);
            fs.writeFileSync(this.lockFile, payload, { encoding: 'utf-8' });
            return true;
        }
        catch (err) {
            console.error(`[ProfileLock] failed to acquire lock for ${this.profileId}:`, err);
            return false;
        }
    }
    release() {
        try {
            if (!fs.existsSync(this.lockFile))
                return;
            const raw = JSON.parse(fs.readFileSync(this.lockFile, 'utf-8'));
            if (Number(raw?.pid) !== process.pid)
                return;
            fs.unlinkSync(this.lockFile);
        }
        catch (err) {
            console.warn(`[ProfileLock] release failed for ${this.profileId}:`, err);
        }
    }
}
//# sourceMappingURL=ProfileLock.js.map