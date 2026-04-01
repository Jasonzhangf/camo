import { resolveInputActionMaxAttempts, resolveInputActionTimeoutMs, resolveInputMode, resolveInputRecoveryBringToFrontTimeoutMs, resolveInputRecoveryDelayMs, resolveInputReadySettleMs, shouldSkipBringToFront } from './utils.js';
import { ensurePageRuntime } from '../pageRuntime.js';

// 15s 强制操作超时（熔断阈值）
const INPUT_ACTION_HARD_TIMEOUT_MS = 15000;

export class BrowserInputPipeline {
    ensurePrimaryPage;
    isHeadless;
    constructor(ensurePrimaryPage, isHeadless) {
        this.ensurePrimaryPage = ensurePrimaryPage;
        this.isHeadless = isHeadless;
    }
    // 队列状态监控（生命周期管理）
    inputActionStartTime = null;
    inputActionLabel = null;
    inputActionTail = Promise.resolve();

    // 获取队列健康状态
    getInputPipelineHealth() {
        if (!this.inputActionStartTime) return { healthy: true, idle: true, elapsedMs: 0 };
        const elapsed = Date.now() - this.inputActionStartTime;
        return {
            healthy: elapsed < INPUT_ACTION_HARD_TIMEOUT_MS,
            idle: false,
            elapsedMs: elapsed,
            label: this.inputActionLabel,
        };
    }

    // 检查当前操作是否已超时
    isCurrentActionTimedOut() {
        if (!this.inputActionStartTime) return false;
        return Date.now() - this.inputActionStartTime > INPUT_ACTION_HARD_TIMEOUT_MS;
    }

    // 强制重置队列（熔断恢复）
    async resetInputActionQueue(reason) {
        console.warn(`[BrowserInputPipeline] 队列熔断: ${reason}, 重置队列`);
        this.inputActionTail = Promise.resolve();
        this.inputActionStartTime = null;
        this.inputActionLabel = null;
    }

    async ensureInputReady(page) {
        if (resolveInputMode() === 'cdp')
            return;
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
        // 熔断检查：前一个操作超时则强制重置队列
        if (this.isCurrentActionTimedOut()) {
            await this.resetInputActionQueue(`操作超时 (${this.inputActionLabel || 'unknown'}, ${(Date.now() - this.inputActionStartTime) / 1000}s)`);
        }
        const previous = this.inputActionTail;
        let release = null;
        this.inputActionTail = new Promise((resolve) => {
            release = () => {
                this.inputActionStartTime = null;
                this.inputActionLabel = null;
                resolve();
            };
        });
        await previous.catch(() => { });
        // 记录当前操作（生命周期追踪）
        this.inputActionStartTime = Date.now();
        this.inputActionLabel = run.name || 'anonymous';
        try {
            // 15s 强制超时保护
            return await this.withInputActionTimeout('withInputActionLock', run, INPUT_ACTION_HARD_TIMEOUT_MS);
        }
        finally {
            if (release)
                release();
        }
    }
}
//# sourceMappingURL=input-pipeline.js.map
