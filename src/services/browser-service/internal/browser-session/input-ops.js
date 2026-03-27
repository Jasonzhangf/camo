import { isTimeoutLikeError } from './utils.js';
import { resolveInputMode } from './utils.js';

async function createCDPSession(page) {
    const context = page.context();
    return context.newCDPSession(page);
}

async function cdpMouseClick(cdp, x, y, button = 'left', delay = 50) {
    const normalizedButton = button === 'left' ? 'left' : button === 'right' ? 'right' : button === 'middle' ? 'middle' : 'left';
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: Math.round(x),
        y: Math.round(y),
        button: normalizedButton,
        clickCount: 1
    });
    if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
    }
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: Math.round(x),
        y: Math.round(y),
        button: normalizedButton,
        clickCount: 1
    });
}

async function cdpMouseMove(cdp, x, y) {
    await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(x),
        y: Math.round(y)
    });
}

async function readInteractiveViewport(page) {
    const fallback = page.viewportSize?.() || null;
    try {
        const metrics = await page.evaluate(() => ({
            innerWidth: Number(window.innerWidth || 0),
            innerHeight: Number(window.innerHeight || 0),
            visualWidth: Number(window.visualViewport?.width || 0),
            visualHeight: Number(window.visualViewport?.height || 0),
        }));
        const width = Math.max(Number(metrics?.innerWidth || 0), Number(metrics?.visualWidth || 0), Number(fallback?.width || 0));
        const height = Math.max(Number(metrics?.innerHeight || 0), Number(metrics?.visualHeight || 0), Number(fallback?.height || 0));
        if (Number.isFinite(width) && width > 1 && Number.isFinite(height) && height > 1) {
            return {
                width: Math.round(width),
                height: Math.round(height),
            };
        }
    }
    catch { }
    return {
        width: Math.max(1, Number(fallback?.width || 1280)),
        height: Math.max(1, Number(fallback?.height || 720)),
    };
}

export class BrowserSessionInputOps {
    ensurePrimaryPage;
    ensureInputReady;
    runInputAction;
    withInputActionLock;
    wheelMode = 'wheel';
    inputActionTail = Promise.resolve();
    constructor(ensurePrimaryPage, ensureInputReady, runInputAction, withInputActionLock) {
        this.ensurePrimaryPage = ensurePrimaryPage;
        this.ensureInputReady = ensureInputReady;
        this.runInputAction = runInputAction;
        this.withInputActionLock = withInputActionLock;
        const envMode = String(process.env.CAMO_SCROLL_INPUT_MODE || '').trim().toLowerCase();
        this.wheelMode = envMode === 'keyboard' ? 'keyboard' : 'wheel';
        this.inputMode = resolveInputMode();
    }
    async mouseClick(opts) {
        const page = await this.ensurePrimaryPage();

        if (this.inputMode === 'cdp') {
            const { x, y, button = 'left', clicks = 1, delay = 50 } = opts;
            let cdp = null;
            try {
                cdp = await createCDPSession(page);
                for (let i = 0; i < clicks; i++) {
                    if (i > 0) {
                        await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
                    }
                    await this.withInputActionLock(async () => {
                        await this.runInputAction(page, 'mouse:click(cdp)', async () => {
                            await cdpMouseClick(cdp, x, y, button, delay);
                        });
                    });
                }
            } finally {
                if (cdp) {
                    await cdp.detach().catch(() => {});
                }
            }
            return;
        }

        await this.withInputActionLock(async () => {
            await this.runInputAction(page, 'input:ready', (activePage) => this.ensureInputReady(activePage));
            const { x, y, button = 'left', clicks = 1, delay = 50, nudgeBefore = false } = opts;
            const moveToTarget = async (clickPage) => {
                try {
                    await clickPage.mouse.move(x, y, { steps: 1 });
                }
                catch { }
            };
            const nudgePointer = async (clickPage) => {
                const viewport = clickPage.viewportSize();
                const maxX = Math.max(2, Number(viewport?.width || 1280) - 2);
                const maxY = Math.max(2, Number(viewport?.height || 720) - 2);
                const nudgeX = Math.max(2, Math.min(maxX, Math.round(Math.max(24, x * 0.2))));
                const nudgeY = Math.max(2, Math.min(maxY, Math.round(Math.max(24, y * 0.2))));
                await clickPage.mouse.move(nudgeX, nudgeY, { steps: 3 }).catch(() => { });
                await clickPage.waitForTimeout(40).catch(() => { });
            };
            const performClick = async (clickPage, label) => {
                await this.runInputAction(page, label, async (activePage) => {
                    if (nudgeBefore)
                        await nudgePointer(activePage);
                    await moveToTarget(activePage);
                    await activePage.mouse.down({ button });
                    const pause = Math.max(0, Number(delay) || 0);
                    if (pause > 0)
                        await activePage.waitForTimeout(pause).catch(() => { });
                    await activePage.mouse.up({ button });
                });
            };
            for (let i = 0; i < clicks; i++) {
                if (i > 0)
                    await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
                try {
                    await performClick(page, 'mouse:click(direct)');
                }
                catch (error) {
                    if (!isTimeoutLikeError(error))
                        throw error;
                    await performClick(page, 'mouse:click(retry)');
                }
            }
        });
    }
    async mouseMove(opts) {
        const x = Number(opts?.x);
        const y = Number(opts?.y);
        throw new Error(`mouse:move disabled (x=${Number.isFinite(x) ? x : 'NaN'}, y=${Number.isFinite(y) ? y : 'NaN'})`);
    }
    async mouseWheel(opts) {
        const page = await this.ensurePrimaryPage();
        await this.withInputActionLock(async () => {
            await this.runInputAction(page, 'input:ready', (activePage) => this.ensureInputReady(activePage));
            const { deltaX = 0, deltaY, anchorX, anchorY } = opts;
            const normalizedDeltaX = Number(deltaX) || 0;
            const normalizedDeltaY = Number(deltaY) || 0;
            const normalizedAnchorX = Number(anchorX);
            const normalizedAnchorY = Number(anchorY);
            if (normalizedDeltaY === 0 && normalizedDeltaX === 0)
                return;
            const keyboardKey = normalizedDeltaY > 0 ? 'PageDown' : 'PageUp';
            const keyboardTimes = Math.max(1, Math.min(4, Math.round(Math.abs(normalizedDeltaY) / 420) || 1));
            const runKeyboardWheel = async () => {
                for (let i = 0; i < keyboardTimes; i += 1) {
                    await this.runInputAction(page, `mouse:wheel:keyboard:${keyboardKey}`, (p) => p.keyboard.press(keyboardKey));
                    if (i + 1 < keyboardTimes) {
                        await this.runInputAction(page, 'mouse:wheel:keyboard:wait', (p) => p.waitForTimeout(80));
                    }
                }
            };
            if (this.wheelMode === 'keyboard') {
                await runKeyboardWheel();
                return;
            }
            try {
                await this.runInputAction(page, 'mouse:wheel', async (activePage) => {
                    const viewport = await readInteractiveViewport(activePage);
                    const moveX = Number.isFinite(normalizedAnchorX)
                        ? Math.max(1, Math.min(Math.max(1, Number(viewport?.width || 1280) - 1), Math.round(normalizedAnchorX)))
                        : Math.max(1, Math.floor(((viewport?.width || 1280) * 0.5)));
                    const moveY = Number.isFinite(normalizedAnchorY)
                        ? Math.max(1, Math.min(Math.max(1, Number(viewport?.height || 720) - 1), Math.round(normalizedAnchorY)))
                        : Math.max(1, Math.floor(((viewport?.height || 720) * 0.5)));
                    await activePage.mouse.move(moveX, moveY, { steps: 1 }).catch(() => { });
                    await activePage.mouse.wheel(normalizedDeltaX, normalizedDeltaY);
                });
            }
            catch (error) {
                if (!isTimeoutLikeError(error) || normalizedDeltaX !== 0 || normalizedDeltaY === 0)
                    throw error;
                this.wheelMode = 'keyboard';
                await runKeyboardWheel();
            }
        });
    }
    async keyboardType(opts) {
        const page = await this.ensurePrimaryPage();
        await this.withInputActionLock(async () => {
            await this.runInputAction(page, 'input:ready', (activePage) => this.ensureInputReady(activePage));
            const { text, delay = 80, submit } = opts;
            if (text && text.length > 0) {
                await this.runInputAction(page, 'keyboard:type', (activePage) => activePage.keyboard.type(text, { delay }));
            }
            if (submit) {
                await this.runInputAction(page, 'keyboard:press', (activePage) => activePage.keyboard.press('Enter'));
            }
        });
    }
    async keyboardPress(opts) {
        const page = await this.ensurePrimaryPage();
        await this.withInputActionLock(async () => {
            await this.runInputAction(page, 'input:ready', (activePage) => this.ensureInputReady(activePage));
            const { key, delay } = opts;
            await this.runInputAction(page, 'keyboard:press', (activePage) => activePage.keyboard.press(key, typeof delay === 'number' ? { delay } : undefined));
        });
    }
}
//# sourceMappingURL=input-ops.js.map
