export function resolveInputActionTimeoutMs() {
    const raw = Number(process.env.CAMO_INPUT_ACTION_TIMEOUT_MS ?? process.env.CAMO_API_TIMEOUT_MS ?? 30000);
    return Math.max(1000, Number.isFinite(raw) ? raw : 30000);
}
export function resolveNavigationWaitUntil() {
    const raw = String(process.env.CAMO_NAV_WAIT_UNTIL ?? 'commit').trim().toLowerCase();
    if (raw === 'load')
        return 'load';
    if (raw === 'domcontentloaded' || raw === 'dom')
        return 'domcontentloaded';
    if (raw === 'networkidle')
        return 'networkidle';
    return 'commit';
}
export function resolveInputActionMaxAttempts() {
    const raw = Number(process.env.CAMO_INPUT_ACTION_MAX_ATTEMPTS ?? 2);
    return Math.max(1, Math.min(3, Number.isFinite(raw) ? Math.floor(raw) : 2));
}
export function resolveInputRecoveryDelayMs() {
    const raw = Number(process.env.CAMO_INPUT_RECOVERY_DELAY_MS ?? 120);
    return Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 120);
}
export function resolveInputRecoveryBringToFrontTimeoutMs() {
    const raw = Number(process.env.CAMO_INPUT_RECOVERY_BRING_TO_FRONT_TIMEOUT_MS ?? 800);
    return Math.max(100, Number.isFinite(raw) ? Math.floor(raw) : 800);
}
export function resolveInputReadySettleMs() {
    const raw = Number(process.env.CAMO_INPUT_READY_SETTLE_MS ?? 80);
    return Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 80);
}
export function resolveBringToFrontMode() {
    const mode = String(process.env.CAMO_BRING_TO_FRONT_MODE ?? '').trim().toLowerCase();
    if (mode === 'never' || mode === 'off' || mode === 'disabled')
        return 'never';
    if (mode === 'always' || mode === 'on' || mode === 'auto')
        return 'auto';
    const legacy = String(process.env.CAMO_SKIP_BRING_TO_FRONT ?? '').trim().toLowerCase();
    if (legacy === '1' || legacy === 'true' || legacy === 'yes' || legacy === 'on')
        return 'never';
    return 'auto';
}
export function shouldSkipBringToFront() {
    return resolveBringToFrontMode() === 'never';
}
export function isTimeoutLikeError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('timed out') || message.includes('timeout');
}
export function normalizeUrl(raw) {
    try {
        const url = new URL(raw);
        return `${url.origin}${url.pathname}`;
    }
    catch {
        return raw;
    }
}
export async function ensureInputReadyOnPage(page, headless, bringToFrontTimeoutMs, settleMs) {
    if (headless)
        return;
    if (shouldSkipBringToFront()) {
        if (settleMs > 0) {
            await page.waitForTimeout(settleMs).catch(() => { });
        }
        return;
    }
    let bringToFrontTimer = null;
    try {
        await Promise.race([
            page.bringToFront(),
            new Promise((_resolve, reject) => {
                bringToFrontTimer = setTimeout(() => {
                    reject(new Error(`input ready bringToFront timed out after ${bringToFrontTimeoutMs}ms`));
                }, bringToFrontTimeoutMs);
            }),
        ]);
    }
    catch {
        // Best-effort only
    }
    finally {
        if (bringToFrontTimer)
            clearTimeout(bringToFrontTimer);
    }
    if (settleMs > 0) {
        await page.waitForTimeout(settleMs).catch(() => { });
    }
}
//# sourceMappingURL=utils.js.map
