import { ensurePageRuntime } from '../pageRuntime.js';
import { normalizeUrl, resolveNavigationWaitUntil } from './utils.js';
export class BrowserSessionNavigation {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async goto(url) {
        const page = await this.deps.ensurePrimaryPage();
        await page.goto(url, { waitUntil: resolveNavigationWaitUntil() });
        await ensurePageRuntime(page);
        this.deps.recordLastKnownUrl(url);
    }
    async goBack() {
        const page = await this.deps.ensurePrimaryPage();
        const waitUntil = resolveNavigationWaitUntil();
        try {
            const res = await page.goBack({ waitUntil }).catch(() => null);
            await ensurePageRuntime(page, true).catch(() => { });
            this.deps.recordLastKnownUrl(page.url());
            return { ok: Boolean(res), url: page.url() };
        }
        catch {
            await ensurePageRuntime(page, true).catch(() => { });
            this.deps.recordLastKnownUrl(page.url());
            return { ok: false, url: page.url() };
        }
    }
    getCurrentUrl() {
        const page = this.deps.getActivePage();
        if (page)
            return page.url() || this.deps.getLastKnownUrl();
        return this.deps.getLastKnownUrl();
    }
    normalizeUrl(raw) {
        return normalizeUrl(raw);
    }
}
//# sourceMappingURL=navigation.js.map