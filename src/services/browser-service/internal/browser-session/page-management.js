import { spawnSync } from 'node:child_process';
import { ensurePageRuntime } from '../pageRuntime.js';
import { resolveNavigationWaitUntil, normalizeUrl, shouldSkipBringToFront } from './utils.js';
export class BrowserSessionPageManagement {
    deps;
    trackedPages = [];
    trackedPageListeners = new WeakSet();
    trackedPageState = new WeakMap();
    static NEW_PAGE_FORCE_ALIVE_MS = 15_000;
    static ACTIVE_PAGE_FORCE_ALIVE_MS = 5_000;
    constructor(deps) {
        this.deps = deps;
    }
    safeIsClosed(page) {
        if (!page)
            return true;
        try {
            return page.isClosed();
        }
        catch {
            return true;
        }
    }
    markTrackedPage(page, forceAliveMs = 0) {
        if (!page)
            return null;
        const prev = this.trackedPageState.get(page);
        const next = {
            closed: false,
            forceAliveUntil: Math.max(Number(prev?.forceAliveUntil || 0), forceAliveMs > 0 ? Date.now() + forceAliveMs : 0),
        };
        this.trackedPageState.set(page, next);
        return page;
    }
    isTrackedPageAlive(page) {
        if (!page)
            return false;
        const state = this.trackedPageState.get(page);
        if (state?.closed === true)
            return false;
        if (!this.safeIsClosed(page))
            return true;
        return Number(state?.forceAliveUntil || 0) > Date.now();
    }
    rememberPage(page, options = {}) {
        if (!page)
            return null;
        this.markTrackedPage(page, Math.max(0, Number(options.forceAliveMs || 0) || 0));
        if (this.safeIsClosed(page) && !this.isTrackedPageAlive(page))
            return null;
        if (!this.trackedPages.includes(page)) {
            this.trackedPages.push(page);
        }
        if (typeof page.on === 'function' && !this.trackedPageListeners.has(page)) {
            page.on('close', () => {
                this.trackedPageState.set(page, {
                    closed: true,
                    forceAliveUntil: 0,
                });
                this.trackedPages = this.trackedPages.filter((item) => item !== page && !item.isClosed());
            });
            this.trackedPageListeners.add(page);
        }
        return page;
    }
    collectPages(ctx) {
        const active = this.deps.getActivePage();
        if (active) {
            this.rememberPage(active, {
                forceAliveMs: BrowserSessionPageManagement.ACTIVE_PAGE_FORCE_ALIVE_MS,
            });
        }
        const merged = [...ctx.pages(), ...this.trackedPages, ...(active ? [active] : [])];
        const seen = new Set();
        const pages = [];
        for (const page of merged) {
            const tracked = this.trackedPages.includes(page) || page === active;
            const alive = tracked ? this.isTrackedPageAlive(page) : !this.safeIsClosed(page);
            if (!page || !alive || seen.has(page))
                continue;
            seen.add(page);
            pages.push(page);
            this.rememberPage(page);
        }
        this.trackedPages = this.trackedPages.filter((page) => page && this.isTrackedPageAlive(page));
        return pages;
    }
    async openPageViaContext(ctx, beforeCount) {
        try {
            const page = this.rememberPage(await ctx.newPage(), {
                forceAliveMs: BrowserSessionPageManagement.NEW_PAGE_FORCE_ALIVE_MS,
            });
            await page.waitForLoadState('domcontentloaded', { timeout: 1500 }).catch(() => null);
            const after = this.collectPages(ctx).length;
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
            const page = this.rememberPage(await waitPage, {
                forceAliveMs: BrowserSessionPageManagement.NEW_PAGE_FORCE_ALIVE_MS,
            });
            const pagesNow = this.collectPages(ctx);
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
            this.rememberPage(existing);
            try {
                await this.deps.ensurePageViewport(existing);
            }
            catch {
                /* ignore */
            }
            return existing;
        }
        const page = this.rememberPage(await ctx.newPage(), {
            forceAliveMs: BrowserSessionPageManagement.NEW_PAGE_FORCE_ALIVE_MS,
        });
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
        const pages = this.collectPages(ctx);
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
        const before = this.collectPages(ctx).length;
        if (!options?.strictShortcut) {
            page = await this.openPageViaContext(ctx, before);
        }
        if (!page) {
            page = await this.openPageViaShortcut(ctx, opener, shortcut, before);
        }
        let after = this.collectPages(ctx).length;
        if (!page || after <= before) {
            const waitPage = ctx.waitForEvent('page', { timeout: 1200 }).catch(() => null);
            const osShortcutOk = this.tryOsNewTabShortcut();
            if (osShortcutOk) {
                page = this.rememberPage(await waitPage, {
                    forceAliveMs: BrowserSessionPageManagement.NEW_PAGE_FORCE_ALIVE_MS,
                });
            }
            const pagesNow = this.collectPages(ctx);
            after = pagesNow.length;
            if (!page && after > before) {
                page = pagesNow[pagesNow.length - 1] || null;
            }
        }
        if (!page || after <= before) {
            if (!options?.strictShortcut) {
                page = await this.openPageViaContext(ctx, before);
                after = this.collectPages(ctx).length;
                if (!page && after > before) {
                    const pagesNow = this.collectPages(ctx);
                    page = pagesNow[pagesNow.length - 1] || null;
                }
            }
        }
        if (!page || after <= before) {
            throw new Error('new_tab_failed');
        }
        this.deps.setupPageHooks(page);
        this.rememberPage(page, {
            forceAliveMs: BrowserSessionPageManagement.NEW_PAGE_FORCE_ALIVE_MS,
        });
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
        const pages = this.collectPages(ctx);
        return { index: Math.max(0, pages.indexOf(page)), url: page.url() };
    }
    async switchPage(index) {
        const ctx = this.deps.ensureContext();
        const pages = this.collectPages(ctx);
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
        const pages = this.collectPages(ctx);
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
        this.trackedPageState.set(page, { closed: true, forceAliveUntil: 0 });
        await page.close().catch(() => { });
        this.trackedPages = this.trackedPages.filter((item) => item !== page && !item.isClosed());
        const remaining = this.collectPages(ctx);
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
