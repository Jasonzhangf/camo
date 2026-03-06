import { isTimeoutLikeError } from './utils.js';
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
    }
    async mouseClick(opts) {
        const page = await this.ensurePrimaryPage();
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
            for (let i = 0; i < clicks; i++) {
                if (i > 0)
                    await new Promise(r => setTimeout(r, 100 + Math.random() * 100));
                try {
                    await this.runInputAction(page, 'mouse:click(direct)', async (clickPage) => {
                        if (nudgeBefore)
                            await nudgePointer(clickPage);
                        await moveToTarget(clickPage);
                        await clickPage.mouse.click(x, y, { button, clickCount: 1, delay: Math.max(0, Number(delay) || 0) });
                    });
                }
                catch (error) {
                    if (!isTimeoutLikeError(error))
                        throw error;
                    await this.runInputAction(page, 'mouse:click(retry)', async (clickPage) => {
                        await nudgePointer(clickPage);
                        await moveToTarget(clickPage);
                        await clickPage.mouse.click(x, y, { button, clickCount: 1, delay: Math.max(0, Number(delay) || 0) });
                    });
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
                    const viewport = activePage.viewportSize();
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
