import { resolveInputActionMaxAttempts, resolveInputActionTimeoutMs, resolveInputRecoveryBringToFrontTimeoutMs, resolveInputRecoveryDelayMs, resolveInputReadySettleMs, shouldSkipBringToFront } from './utils.js';
import { ensurePageRuntime } from '../pageRuntime.js';
export class BrowserInputPipeline {
    ensurePrimaryPage;
    isHeadless;
    constructor(ensurePrimaryPage, isHeadless) {
        this.ensurePrimaryPage = ensurePrimaryPage;
        this.isHeadless = isHeadless;
    }
    inputActionTail = Promise.resolve();
    async ensureInputReady(page) {
        if (this.isHeadless())
            return;
        if (shouldSkipBringToFront()) {
            const settleMs = resolveInputReadySettleMs();
            if (settleMs > 0) {
                await page.waitForTimeout(settleMs).catch(() => { });
            }
            return;
        }
        const bringToFrontTimeoutMs = resolveInputRecoveryBringToFrontTimeoutMs();
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
        const settleMs = resolveInputReadySettleMs();
        if (settleMs > 0) {
            await page.waitForTimeout(settleMs).catch(() => { });
        }
    }
    async resolveInputPage(preferredPage) {
        try {
            const page = await this.ensurePrimaryPage();
            if (page && !page.isClosed())
                return page;
        }
        catch { }
        if (preferredPage && !preferredPage.isClosed())
            return preferredPage;
        return this.ensurePrimaryPage();
    }
    async withInputActionTimeout(label, run, timeoutOverrideMs) {
        const resolvedOverride = Number(timeoutOverrideMs);
        const timeoutMs = Number.isFinite(resolvedOverride) && resolvedOverride > 0
            ? Math.floor(resolvedOverride)
            : resolveInputActionTimeoutMs();
        let timer = null;
        try {
            return await Promise.race([
                run(),
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
                }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async recoverInputPipeline(page) {
        const activePage = await this.resolveInputPage(page).catch(() => page);
        if (!shouldSkipBringToFront()) {
        const bringToFrontTimeoutMs = resolveInputRecoveryBringToFrontTimeoutMs();
        let bringToFrontTimer = null;
        try {
            await Promise.race([
                activePage.bringToFront(),
                new Promise((_resolve, reject) => {
                    bringToFrontTimer = setTimeout(() => {
                        reject(new Error(`input recovery bringToFront timed out after ${bringToFrontTimeoutMs}ms`));
                    }, bringToFrontTimeoutMs);
                }),
            ]);
        }
        catch {
            // Best-effort recovery only.
        }
        finally {
            if (bringToFrontTimer)
                clearTimeout(bringToFrontTimer);
        }
        }
        const delayMs = resolveInputRecoveryDelayMs();
        if (delayMs > 0) {
            try {
                await activePage.waitForTimeout(delayMs);
            }
            catch { }
        }
        await ensurePageRuntime(activePage, true).catch(() => { });
        return this.resolveInputPage(activePage).catch(() => activePage);
    }
    async runInputAction(page, label, run) {
        const maxAttempts = resolveInputActionMaxAttempts();
        let lastError = null;
        let activePage = page;
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            activePage = await this.resolveInputPage(activePage).catch(() => activePage);
            try {
                return await this.withInputActionTimeout(`${label} (attempt ${attempt}/${maxAttempts})`, () => run(activePage));
            }
            catch (error) {
                lastError = error;
                if (attempt >= maxAttempts)
                    break;
                activePage = await this.recoverInputPipeline(activePage);
            }
        }
        if (lastError instanceof Error)
            throw lastError;
        throw new Error(`${label} failed`);
    }
    async withInputActionLock(run) {
        const previous = this.inputActionTail;
        let release = null;
        this.inputActionTail = new Promise((resolve) => { release = resolve; });
        await previous.catch(() => { });
        try {
            return await run();
        }
        finally {
            if (release)
                release();
        }
    }
}
//# sourceMappingURL=input-pipeline.js.map
