import { spawnSync } from 'node:child_process';
import { ensurePageRuntime } from '../pageRuntime.js';
import { resolveNavigationWaitUntil, normalizeUrl, shouldSkipBringToFront } from './utils.js';
export class BrowserSessionPageManagement {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async openPageViaContext(ctx, beforeCount) {
        try {
            const page = await ctx.newPage();
            await page.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => null);
            const after = ctx.pages().filter((p) => !p.isClosed()).length;
            if (after > beforeCount) {
                return page;
            }
        }
        catch {
            // Fall through to shortcut-based creation below.
        }
        return null;
    }
    async openPageViaShortcut(ctx, opener, shortcut, beforeCount) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const waitPage = ctx.waitForEvent('page', { timeout: 1200 }).catch(() => null);
            await opener.keyboard.press(shortcut).catch(() => null);
            const page = await waitPage;
            const pagesNow = ctx.pages().filter((p) => !p.isClosed());
            const after = pagesNow.length;
            if (page && after > beforeCount)
                return page;
            if (!page && after > beforeCount) {
                return pagesNow[pagesNow.length - 1] || null;
            }
            await new Promise((r) => setTimeout(r, 250));
        }
        return null;
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
        // Filter out closed pages AND pages that are effectively blank (about:newtab/about:blank)
        const pages = ctx.pages().filter((p) => {
            if (p.isClosed()) return false;
            const url = p.url();
            // Filter out blank placeholder pages
            if (url === 'about:newtab' || url === 'about:blank') return false;
            return true;
        });
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
        if (!options?.strictShortcut) {
            page = await this.openPageViaContext(ctx, before);
        }
        if (!page) {
            page = await this.openPageViaShortcut(ctx, opener, shortcut, before);
        }
        let after = ctx.pages().filter((p) => !p.isClosed()).length;
        if (!page || after <= before) {
            const waitPage = ctx.waitForEvent('page', { timeout: 1200 }).catch(() => null);
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
                page = await this.openPageViaContext(ctx, before);
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
        const beforeUrl = page.url();
        
        // Try to close the page
        try {
            await page.close({ runBeforeUnload: false });
        } catch (e) {
            // Ignore close errors
        }
        
        // Wait for close to take effect
        await new Promise(r => setTimeout(r, 100));
        
        // Check if actually closed
        let remaining = ctx.pages().filter((p) => !p.isClosed());
        
        // If still same count, the page might not have closed properly
        // Try navigating to about:blank first then close
        if (remaining.length === pages.length) {
            try {
                await page.goto('about:blank', { timeout: 500 }).catch(() => {});
                await page.close({ runBeforeUnload: false }).catch(() => {});
                await new Promise(r => setTimeout(r, 100));
                remaining = ctx.pages().filter((p) => !p.isClosed());
            } catch (e) {
                // Ignore
            }
        }
        
        // Final check - filter out pages that look like closed tabs (about:newtab)
        remaining = remaining.filter(p => {
            const url = p.url();
            return url !== 'about:newtab' && url !== 'about:blank';
        });
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
