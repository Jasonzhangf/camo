import { spawnSync } from 'node:child_process';
import { ensurePageRuntime } from '../pageRuntime.js';
import { resolveNavigationWaitUntil, normalizeUrl, shouldSkipBringToFront } from './utils.js';
export class BrowserSessionPageManagement {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    tryOsNewTabShortcut() {
        if (this.deps.isHeadless())
            return false;
        if (process.platform === 'darwin') {
            const res = spawnSync('osascript', ['-e', 'tell application "System Events" to keystroke "t" using command down'], { windowsHide: true });
            return res.status === 0;
        }
        if (process.platform === 'win32') {
            const script = 'Add-Type -AssemblyName System.Windows.Forms; $ws = New-Object -ComObject WScript.Shell; $ws.SendKeys("^t");';
            const res = spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
            return res.status === 0;
        }
        return false;
    }
    async ensurePrimaryPage() {
        const ctx = this.deps.ensureContext();
        const existing = this.deps.getActivePage();
        if (existing) {
            try {
                await this.deps.ensurePageViewport(existing);
            }
            catch {
                /* ignore */
            }
            return existing;
        }
        const page = await ctx.newPage();
        this.deps.setActivePage(page);
        this.deps.setupPageHooks(page);
        try {
            await this.deps.ensurePageViewport(page);
        }
        catch {
            /* ignore */
        }
        return page;
    }
    async ensurePage(url) {
        let page = await this.ensurePrimaryPage();
        if (url) {
            const current = this.deps.getCurrentUrl() || page.url();
            if (!current || normalizeUrl(current) !== normalizeUrl(url)) {
                await page.goto(url, { waitUntil: resolveNavigationWaitUntil() });
                await ensurePageRuntime(page);
                this.deps.recordLastKnownUrl(url);
                page = await this.ensurePrimaryPage();
            }
        }
        return page;
    }
    listPages() {
        const ctx = this.deps.ensureContext();
        const pages = ctx.pages().filter((p) => !p.isClosed());
        const active = this.deps.getActivePage();
        return pages.map((p, index) => ({
            index,
            url: p.url(),
            active: active === p,
        }));
    }
    async newPage(url, options = {}) {
        const ctx = this.deps.ensureContext();
        const isMac = process.platform === 'darwin';
        const shortcut = isMac ? 'Meta+t' : 'Control+t';
        let page = null;
        const opener = this.deps.getActivePage() || ctx.pages()[0];
        if (!opener)
            throw new Error('no_opener_page');
        if (!shouldSkipBringToFront()) {
            await opener.bringToFront().catch(() => null);
        }
        const before = ctx.pages().filter((p) => !p.isClosed()).length;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const waitPage = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
            await opener.keyboard.press(shortcut).catch(() => null);
            page = await waitPage;
            const pagesNow = ctx.pages().filter((p) => !p.isClosed());
            const after = pagesNow.length;
            if (page && after > before)
                break;
            if (!page && after > before) {
                page = pagesNow[pagesNow.length - 1] || null;
                break;
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        let after = ctx.pages().filter((p) => !p.isClosed()).length;
        if (!page || after <= before) {
            const waitPage = ctx.waitForEvent('page', { timeout: 8000 }).catch(() => null);
            const osShortcutOk = this.tryOsNewTabShortcut();
            if (osShortcutOk) {
                page = await waitPage;
            }
            const pagesNow = ctx.pages().filter((p) => !p.isClosed());
            after = pagesNow.length;
            if (!page && after > before) {
                page = pagesNow[pagesNow.length - 1] || null;
            }
        }
        if (!page || after <= before) {
            if (!options?.strictShortcut) {
                try {
                    page = await ctx.newPage();
                    await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => null);
                }
                catch {
                    // ignore fallback errors
                }
                after = ctx.pages().filter((p) => !p.isClosed()).length;
                if (!page && after > before) {
                    const pagesNow = ctx.pages().filter((p) => !p.isClosed());
                    page = pagesNow[pagesNow.length - 1] || null;
                }
            }
        }
        if (!page || after <= before) {
            throw new Error('new_tab_failed');
        }
        this.deps.setupPageHooks(page);
        this.deps.setActivePage(page);
        try {
            await this.deps.ensurePageViewport(page);
        }
        catch {
            /* ignore */
        }
        try {
            await this.deps.maybeCenterPage(page, { width: 1920, height: 1080 });
        }
        catch {
            /* ignore */
        }
        if (!shouldSkipBringToFront()) {
            try {
                await page.bringToFront();
            }
            catch {
                /* ignore */
            }
        }
        if (url) {
            await page.goto(url, { waitUntil: resolveNavigationWaitUntil() });
            await ensurePageRuntime(page);
            this.deps.recordLastKnownUrl(url);
        }
        const pages = ctx.pages().filter((p) => !p.isClosed());
        return { index: Math.max(0, pages.indexOf(page)), url: page.url() };
    }
    async switchPage(index) {
        const ctx = this.deps.ensureContext();
        const pages = ctx.pages().filter((p) => !p.isClosed());
        const idx = Number(index);
        if (!Number.isFinite(idx) || idx < 0 || idx >= pages.length) {
            throw new Error(`invalid_page_index: ${index}`);
        }
        const page = pages[idx];
        this.deps.setActivePage(page);
        try {
            await this.deps.ensurePageViewport(page);
        }
        catch {
            /* ignore */
        }
        if (!shouldSkipBringToFront()) {
            try {
                await page.bringToFront();
            }
            catch {
                /* ignore */
            }
        }
        await ensurePageRuntime(page, true).catch(() => { });
        this.deps.recordLastKnownUrl(page.url());
        return { index: idx, url: page.url() };
    }
    async closePage(index) {
        const ctx = this.deps.ensureContext();
        const pages = ctx.pages().filter((p) => !p.isClosed());
        if (pages.length === 0) {
            return { closedIndex: -1, activeIndex: -1, total: 0 };
        }
        const active = this.deps.getActivePage();
        const requested = typeof index === 'number' && Number.isFinite(index) ? index : null;
        const closedIndex = requested !== null ? requested : Math.max(0, pages.findIndex((p) => p === active));
        if (closedIndex < 0 || closedIndex >= pages.length) {
            throw new Error(`invalid_page_index: ${index}`);
        }
        const page = pages[closedIndex];
        await page.close().catch(() => { });
        const remaining = ctx.pages().filter((p) => !p.isClosed());
        const nextIndex = remaining.length === 0 ? -1 : Math.min(Math.max(0, closedIndex - 1), remaining.length - 1);
        if (nextIndex >= 0) {
            const nextPage = remaining[nextIndex];
            this.deps.setActivePage(nextPage);
            if (!shouldSkipBringToFront()) {
                try {
                    await nextPage.bringToFront();
                }
                catch {
                    /* ignore */
                }
            }
            await ensurePageRuntime(nextPage, true).catch(() => { });
            this.deps.recordLastKnownUrl(nextPage.url());
        }
        else {
            this.deps.setActivePage(undefined);
        }
        return { closedIndex, activeIndex: nextIndex, total: remaining.length };
    }
}
//# sourceMappingURL=page-management.js.map
