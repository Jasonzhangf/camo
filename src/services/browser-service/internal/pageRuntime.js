import { injectRuntimeBundle } from './runtimeInjector.js';
const injectedPages = new WeakSet();
export async function ensurePageRuntime(page, forceReinject = false) {
    if (!page) {
        throw new Error('page is required');
    }
    // 强制重新注入或首次注入
    if (forceReinject || !injectedPages.has(page)) {
        await injectRuntimeBundle({ page });
        injectedPages.add(page);
    }
    try {
        await page.waitForFunction(() => Boolean(window.__camoRuntime && window.__camoRuntime.ready), {
            timeout: 4000,
        });
    }
    catch (err) {
        // Runtime is best-effort for system-level mouse/keyboard commands.
        // If injection readiness times out (common on slow/heavy pages), we must not block
        // low-level commands like mouse:click/mouse:wheel.
        // Higher-level operations (containers:match, overlay highlight) will handle their own retries.
        return;
    }
}
export async function evalPageRuntime(page, fn) {
    await ensurePageRuntime(page);
    return page.evaluate(fn);
}
//# sourceMappingURL=pageRuntime.js.map