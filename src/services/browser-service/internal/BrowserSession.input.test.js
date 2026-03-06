import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserSession } from './BrowserSession.js';
function setEnv(key, value) {
    const prev = process.env[key];
    process.env[key] = value;
    return () => {
        if (prev === undefined)
            delete process.env[key];
        else
            process.env[key] = prev;
    };
}
function createSessionWithPage(page) {
    const session = new BrowserSession({ profileId: `test-input-${Date.now()}` });
    session.ensurePrimaryPage = async () => page;
    session.ensureInputReady = async () => { };
    return session;
}
test('mouseMove is disabled to avoid unstable pointer movement path', async () => {
    const page = {
        mouse: {
            move: async () => { },
        },
        bringToFront: async () => { },
        waitForTimeout: async () => { },
    };
    const session = createSessionWithPage(page);
    await assert.rejects(async () => session.mouseMove({ x: 10, y: 20 }), /mouse:move disabled/i);
});
test('input actions are serialized per session', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '200');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    try {
        let active = 0;
        let maxActive = 0;
        const page = {
            mouse: {
                click: async () => {
                    active += 1;
                    maxActive = Math.max(maxActive, active);
                    await new Promise((resolve) => setTimeout(resolve, 40));
                    active -= 1;
                },
            },
            bringToFront: async () => { },
            waitForTimeout: async () => { },
        };
        const session = createSessionWithPage(page);
        await Promise.all([
            session.mouseClick({ x: 1, y: 1, delay: 0 }),
            session.mouseClick({ x: 2, y: 2, delay: 0 }),
        ]);
        assert.equal(maxActive, 1);
    }
    finally {
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('mouseClick uses direct click pipeline', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '200');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    try {
        const calls = [];
        const page = {
            mouse: {
                click: async () => {
                    calls.push('click');
                },
            },
            bringToFront: async () => { },
            waitForTimeout: async () => { },
        };
        const session = createSessionWithPage(page);
        await session.mouseClick({ x: 11, y: 22, delay: 0 });
        assert.deepEqual(calls, ['click']);
    }
    finally {
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('mouseClick repeats direct click for multi-click', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '200');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    try {
        const calls = [];
        const page = {
            mouse: {
                click: async () => {
                    calls.push('click');
                },
            },
            bringToFront: async () => { },
            waitForTimeout: async () => { },
        };
        const session = createSessionWithPage(page);
        await session.mouseClick({ x: 15, y: 25, delay: 0, clicks: 2 });
        assert.deepEqual(calls, ['click', 'click']);
    }
    finally {
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('mouseClick nudges pointer before click when nudgeBefore is true', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '200');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    try {
        const moves = [];
        const page = {
            isClosed: () => false,
            viewportSize: () => ({ width: 1000, height: 700 }),
            bringToFront: async () => { },
            waitForTimeout: async () => { },
            mouse: {
                move: async (x, y) => {
                    moves.push([x, y]);
                },
                click: async () => { },
            },
        };
        const session = createSessionWithPage(page);
        await session.mouseClick({ x: 120, y: 200, delay: 0, nudgeBefore: true });
        assert.ok(moves.length >= 2);
        assert.deepEqual(moves[moves.length - 1], [120, 200]);
        assert.notDeepEqual(moves[0], [120, 200]);
    }
    finally {
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('mouseClick falls back to down/up when direct click times out', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '80');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    const restoreBringToFrontTimeout = setEnv('CAMO_INPUT_RECOVERY_BRING_TO_FRONT_TIMEOUT_MS', '50');
    const restoreReadySettle = setEnv('CAMO_INPUT_READY_SETTLE_MS', '0');
    try {
        const calls = [];
        const page = {
            isClosed: () => false,
            viewportSize: () => ({ width: 1000, height: 700 }),
            bringToFront: async () => { },
            waitForTimeout: async () => { },
            mouse: {
                clickAttempts: 0,
                click: async function click() {
                    this.clickAttempts += 1;
                    if (this.clickAttempts === 1)
                        return new Promise(() => { });
                    calls.push('click_retry');
                },
                move: async () => {
                    calls.push('move');
                },
            },
        };
        const session = createSessionWithPage(page);
        await session.mouseClick({ x: 11, y: 22, delay: 0 });
        assert.equal(calls.includes('click_retry'), true);
    }
    finally {
        restoreReadySettle();
        restoreBringToFrontTimeout();
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('ensureInputReady brings page to front even when document reports focus', async () => {
    const page = {
        bringToFrontCount: 0,
        waitCount: 0,
        bringToFront: async function bringToFront() {
            this.bringToFrontCount += 1;
        },
        waitForTimeout: async function waitForTimeout() {
            this.waitCount += 1;
        },
        evaluate: async () => ({
            hasFocus: true,
            hidden: false,
            visibilityState: 'visible',
        }),
        isClosed: () => false,
    };
    const session = new BrowserSession({ profileId: `test-input-ready-${Date.now()}` });
    await session.inputPipeline.ensureInputReady(page);
    assert.equal(page.bringToFrontCount, 1);
    assert.equal(page.waitCount, 1);
});
test('ensureInputReady skips bringToFront when CAMO_BRING_TO_FRONT_MODE=never', async () => {
    const restoreSkip = setEnv('CAMO_BRING_TO_FRONT_MODE', 'never');
    try {
        const page = {
            bringToFrontCount: 0,
            waitCount: 0,
            bringToFront: async function bringToFront() {
                this.bringToFrontCount += 1;
            },
            waitForTimeout: async function waitForTimeout() {
                this.waitCount += 1;
            },
            evaluate: async () => ({
                hasFocus: false,
                hidden: false,
                visibilityState: 'visible',
            }),
            isClosed: () => false,
        };
        const session = new BrowserSession({ profileId: `test-input-ready-skip-${Date.now()}` });
        await session.inputPipeline.ensureInputReady(page);
        assert.equal(page.bringToFrontCount, 0);
        assert.equal(page.waitCount, 1);
    }
    finally {
        restoreSkip();
    }
});
test('mouseWheel retries with refreshed active page after timeout', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '80');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '2');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    const restoreBringToFrontTimeout = setEnv('CAMO_INPUT_RECOVERY_BRING_TO_FRONT_TIMEOUT_MS', '50');
    const restoreReadySettle = setEnv('CAMO_INPUT_READY_SETTLE_MS', '0');
    try {
        const calls = [];
        const page1 = {
            isClosed: () => false,
            viewportSize: () => ({ width: 1280, height: 720 }),
            bringToFront: async () => { },
            waitForTimeout: async () => { },
            mouse: {
                move: async () => { },
                wheel: async () => new Promise(() => { }),
            },
        };
        const page2 = {
            isClosed: () => false,
            viewportSize: () => ({ width: 1280, height: 720 }),
            bringToFront: async () => { },
            waitForTimeout: async () => { },
            mouse: {
                move: async () => { },
                wheel: async () => {
                    calls.push('wheel_ok');
                },
            },
        };
        const session = new BrowserSession({ profileId: `test-input-refresh-${Date.now()}` });
        let ensurePrimaryPageCalls = 0;
        session.ensureInputReady = async () => { };
        session.ensurePrimaryPage = async () => {
            ensurePrimaryPageCalls += 1;
            return ensurePrimaryPageCalls <= 3 ? page1 : page2;
        };
        await session.mouseWheel({ deltaY: 360 });
        assert.equal(calls.length, 1);
        assert.ok(ensurePrimaryPageCalls >= 4);
    }
    finally {
        restoreReadySettle();
        restoreBringToFrontTimeout();
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('mouseWheel falls back to keyboard paging when wheel keeps timing out', async () => {
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '80');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    const restoreBringToFrontTimeout = setEnv('CAMO_INPUT_RECOVERY_BRING_TO_FRONT_TIMEOUT_MS', '50');
    const restoreReadySettle = setEnv('CAMO_INPUT_READY_SETTLE_MS', '0');
    try {
        const calls = [];
        const page = {
            isClosed: () => false,
            viewportSize: () => ({ width: 1280, height: 720 }),
            bringToFront: async () => { },
            waitForTimeout: async () => { },
            mouse: {
                move: async () => { },
                wheel: async () => new Promise(() => { }),
            },
            keyboard: {
                press: async (key) => {
                    calls.push(`press:${key}`);
                },
            },
        };
        const session = new BrowserSession({ profileId: `test-input-fallback-${Date.now()}` });
        session.ensureInputReady = async () => { };
        session.ensurePrimaryPage = async () => page;
        await session.mouseWheel({ deltaY: 420 });
        assert.deepEqual(calls, ['press:PageDown']);
    }
    finally {
        restoreReadySettle();
        restoreBringToFrontTimeout();
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
    }
});
test('mouseWheel uses keyboard mode directly when CAMO_SCROLL_INPUT_MODE=keyboard', async () => {
    const restoreMode = setEnv('CAMO_SCROLL_INPUT_MODE', 'keyboard');
    const restoreTimeout = setEnv('CAMO_INPUT_ACTION_TIMEOUT_MS', '80');
    const restoreAttempts = setEnv('CAMO_INPUT_ACTION_MAX_ATTEMPTS', '1');
    const restoreDelay = setEnv('CAMO_INPUT_RECOVERY_DELAY_MS', '0');
    const restoreBringToFrontTimeout = setEnv('CAMO_INPUT_RECOVERY_BRING_TO_FRONT_TIMEOUT_MS', '50');
    const restoreReadySettle = setEnv('CAMO_INPUT_READY_SETTLE_MS', '0');
    try {
        const calls = [];
        const page = {
            isClosed: () => false,
            bringToFront: async () => { },
            waitForTimeout: async () => { },
            mouse: {
                wheel: async () => {
                    calls.push('wheel');
                },
            },
            keyboard: {
                press: async (key) => {
                    calls.push(`press:${key}`);
                },
            },
        };
        const session = new BrowserSession({ profileId: `test-input-mode-${Date.now()}` });
        session.ensureInputReady = async () => { };
        session.ensurePrimaryPage = async () => page;
        await session.mouseWheel({ deltaY: 760 });
        assert.deepEqual(calls, ['press:PageDown', 'press:PageDown']);
    }
    finally {
        restoreReadySettle();
        restoreBringToFrontTimeout();
        restoreDelay();
        restoreAttempts();
        restoreTimeout();
        restoreMode();
    }
});
//# sourceMappingURL=BrowserSession.input.test.js.map
