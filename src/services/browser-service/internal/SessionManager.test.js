import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionManager } from './SessionManager.js';
test('createSession closes session when start fails', async () => {
    let closeCalled = 0;
    const fakeSession = {
        id: 'start-fail-profile',
        modeName: 'dev',
        onExit: undefined,
        async start() {
            throw new Error('start_failed');
        },
        async close() {
            closeCalled += 1;
        },
        getCurrentUrl() {
            return null;
        },
        getRecordingStatus() {
            return {
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
        },
    };
    const manager = new SessionManager({ ownerWatchdogMs: 60_000 }, () => fakeSession);
    await assert.rejects(async () => manager.createSession({ profileId: 'start-fail-profile' }), /start_failed/);
    assert.equal(closeCalled, 1);
    assert.equal(manager.getSession('start-fail-profile'), undefined);
    await manager.shutdown();
});
//# sourceMappingURL=SessionManager.test.js.map