import os from 'os';
export function resolveDeviceScaleFactor(profileId) {
    const raw = String(process.env.CAMO_DEVICE_SCALE || '').trim();
    if (raw) {
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed > 0)
            return parsed;
    }
    if (os.platform() === 'win32' && profileId?.startsWith('xiaohongshu_')) {
        return 1;
    }
    return null;
}
export async function syncDeviceScaleFactor(page, context, viewport, engine) {
    if (engine !== 'chromium')
        return;
    const desired = resolveDeviceScaleFactor();
    if (!desired || !context)
        return;
    try {
        const client = await context.newCDPSession(page);
        await client.send('Emulation.setDeviceMetricsOverride', {
            width: viewport.width,
            height: viewport.height,
            deviceScaleFactor: desired,
            mobile: false,
            scale: 1,
        });
    }
    catch (error) {
        console.warn(`[browser-session] sync device scale failed: ${error?.message || String(error)}`);
    }
}
export async function readWindowInnerSize(page) {
    try {
        const metrics = await page.evaluate(() => ({
            width: Math.floor(Number(window.innerWidth || 0)),
            height: Math.floor(Number(window.innerHeight || 0)),
        }));
        const width = Number(metrics?.width);
        const height = Number(metrics?.height);
        if (!Number.isFinite(width) || !Number.isFinite(height))
            return null;
        if (width < 300 || height < 200)
            return null;
        return { width, height };
    }
    catch {
        return null;
    }
}
export async function refreshViewportFromWindow(page) {
    const inner = await readWindowInnerSize(page);
    if (!inner)
        return null;
    return {
        width: Math.max(800, Math.floor(inner.width)),
        height: Math.max(700, Math.floor(inner.height)),
    };
}
export async function syncWindowBounds(page, context, viewport, engine, headless) {
    // Log viewport metrics for diagnosis
    try {
        const metrics = await page.evaluate(() => ({
            innerWidth: window.innerWidth || 0,
            innerHeight: window.innerHeight || 0,
            outerWidth: window.outerWidth || 0,
            outerHeight: window.outerHeight || 0,
            screenX: Math.floor(window.screenX || 0),
            screenY: Math.floor(window.screenY || 0),
            devicePixelRatio: window.devicePixelRatio || 1,
            visualViewport: window.visualViewport ? {
                width: window.visualViewport.width || 0,
                height: window.visualViewport.height || 0,
                offsetLeft: window.visualViewport.offsetLeft || 0,
                offsetTop: window.visualViewport.offsetTop || 0,
                scale: window.visualViewport.scale || 1,
            } : null,
        }));
        console.log(`[viewport-metrics] target=${viewport.width}x${viewport.height} inner=${metrics.innerWidth}x${metrics.innerHeight} outer=${metrics.outerWidth}x${metrics.outerHeight} screen=(${metrics.screenX},${metrics.screenY}) dpr=${metrics.devicePixelRatio} visual=${JSON.stringify(metrics.visualViewport)}`);
        // If inner dimensions don't match target, retry setViewportSize
        const widthDelta = Math.abs(metrics.innerWidth - viewport.width);
        const heightDelta = Math.abs(metrics.innerHeight - viewport.height);
        if (widthDelta > 50 || heightDelta > 50) {
            console.warn(`[viewport-metrics] MISMATCH detected: widthDelta=${widthDelta} heightDelta=${heightDelta}, retrying setViewportSize...`);
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.waitForTimeout(500);
            const retry = await page.evaluate(() => ({
                innerWidth: window.innerWidth || 0,
                innerHeight: window.innerHeight || 0,
            }));
            console.log(`[viewport-metrics] after retry: inner=${retry.innerWidth}x${retry.innerHeight}`);
        }
    }
    catch (err) {
        console.warn(`[viewport-metrics] log failed: ${err?.message || String(err)}`);
    }
    if (engine !== 'chromium')
        return;
    if (headless)
        return;
    if (!context)
        return;
    try {
        const client = await context.newCDPSession(page);
        const { windowId } = await client.send('Browser.getWindowForTarget');
        const metrics = await page.evaluate(() => ({
            innerWidth: window.innerWidth || 0,
            innerHeight: window.innerHeight || 0,
            outerWidth: window.outerWidth || 0,
            outerHeight: window.outerHeight || 0,
        }));
        const deltaW = Math.max(0, Math.floor((metrics.outerWidth || 0) - (metrics.innerWidth || 0)));
        const deltaH = Math.max(0, Math.floor((metrics.outerHeight || 0) - (metrics.innerHeight || 0)));
        const targetWidth = Math.max(300, Math.floor(Number(viewport.width) + deltaW));
        const targetHeight = Math.max(300, Math.floor(Number(viewport.height) + deltaH));
        await client.send('Browser.setWindowBounds', {
            windowId,
            bounds: { width: targetWidth, height: targetHeight },
        });
    }
    catch (error) {
        console.warn(`[browser-session] sync window bounds failed: ${error?.message || String(error)}`);
    }
}
export async function maybeCenterWindow(page, viewport, headless) {
    if (headless)
        return;
    try {
        const metrics = await page.evaluate(() => ({
            screenX: Math.floor(window.screenX || 0),
            screenY: Math.floor(window.screenY || 0),
            outerWidth: Math.floor(window.outerWidth || 0),
            outerHeight: Math.floor(window.outerHeight || 0),
            innerWidth: Math.floor(window.innerWidth || 0),
            innerHeight: Math.floor(window.innerHeight || 0),
            screenWidth: Math.floor(window.screen?.availWidth || window.screen?.width || 0),
            screenHeight: Math.floor(window.screen?.availHeight || window.screen?.height || 0),
        }));
        const sw = Math.max(metrics.screenWidth || 0, viewport.width);
        const sh = Math.max(metrics.screenHeight || 0, viewport.height);
        // Try to resize outer window to fit viewport (inner) + chrome delta
        const deltaW = Math.max(0, (metrics.outerWidth || 0) - (metrics.innerWidth || 0));
        const deltaH = Math.max(0, (metrics.outerHeight || 0) - (metrics.innerHeight || 0));
        const targetOuterW = Math.max(viewport.width + deltaW, 300);
        const targetOuterH = Math.max(viewport.height + deltaH, 300);
        await page.evaluate(({ w, h }) => { try {
            window.resizeTo(w, h);
        }
        catch { } }, { w: targetOuterW, h: targetOuterH });
        await page.waitForTimeout(200);
        const ow = Math.max(metrics.outerWidth || 0, targetOuterW);
        const oh = Math.max(metrics.outerHeight || 0, targetOuterH);
        const targetX = Math.max(0, Math.floor((sw - ow) / 2));
        const targetY = Math.max(0, Math.floor((sh - oh) / 2));
        // Only move if we're clearly off-center
        if (Math.abs(metrics.screenX - targetX) > 5 || Math.abs(metrics.screenY - targetY) > 5) {
            await page.evaluate(({ x, y }) => { try {
                window.moveTo(x, y);
            }
            catch { } }, { x: targetX, y: targetY });
            await page.waitForTimeout(200);
        }
    }
    catch (err) {
        console.warn('[browser-session] maybeCenterWindow failed:', err?.message || String(err));
    }
}
export async function ensurePageViewport(page, state, context, engine, headless) {
    if (state.followWindowViewport) {
        const refreshed = await refreshViewportFromWindow(page).catch(() => null);
        if (refreshed) {
            return { ...state, lastViewport: refreshed };
        }
        return state;
    }
    if (!state.lastViewport)
        return state;
    const current = page.viewportSize();
    if (current && current.width === state.lastViewport.width && current.height === state.lastViewport.height) {
        return state;
    }
    await page.setViewportSize({
        width: state.lastViewport.width,
        height: state.lastViewport.height,
    });
    await syncWindowBounds(page, context, { ...state.lastViewport }, engine, headless);
    await syncDeviceScaleFactor(page, context, { ...state.lastViewport }, engine);
    return state;
}
export async function setViewportSizeOnPage(page, opts, state, context, engine, headless) {
    const width = Math.max(800, Math.floor(Number(opts.width) || 0));
    const height = Math.max(700, Math.floor(Number(opts.height) || 0));
    if (!width || !height) {
        throw new Error('invalid_viewport_size');
    }
    if (state.followWindowViewport && !headless) {
        await page.evaluate(({ w, h }) => {
            try {
                window.resizeTo(w, h);
            }
            catch { }
        }, { w: width, h: height });
        await page.waitForTimeout(150);
        const refreshed = await refreshViewportFromWindow(page).catch(() => null);
        const next = refreshed || { width, height };
        await maybeCenterWindow(page, next, headless).catch(() => { });
        return next;
    }
    await page.setViewportSize({ width, height });
    await syncWindowBounds(page, context, { width, height }, engine, headless);
    await syncDeviceScaleFactor(page, context, { width, height }, engine);
    await maybeCenterWindow(page, { width, height }, headless);
    return { width, height };
}
//# sourceMappingURL=viewport.js.map