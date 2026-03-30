import fs from 'fs';
import path from 'path';
import { ProfileLock } from './ProfileLock.js';
import { BrowserSessionRecording } from './browser-session/recording.js';
import { createPageHooksManager } from './browser-session/page-hooks.js';
import { BrowserSessionCookies } from './browser-session/cookies.js';
import { BrowserSessionPageManagement } from './browser-session/page-management.js';
import { BrowserInputPipeline } from './browser-session/input-pipeline.js';
import { BrowserSessionInputOps } from './browser-session/input-ops.js';
import { createRuntimeEventManager } from './browser-session/runtime-events.js';
import { BrowserSessionNavigation } from './browser-session/navigation.js';
import { BrowserSessionViewportManager } from './browser-session/viewport-manager.js';
import { logDebug } from './logging.js';
import { loadOrGenerateFingerprint, applyFingerprint } from './fingerprint.js';
import { launchEngineContext } from './engine-manager.js';
import { resolveProfilesRoot } from './storage-paths.js';
export class BrowserSession {
    options;
    browser;
    context;
    page;
    lock;
    profileDir;
    lastKnownUrl = null;
    mode = 'dev';
    cookiesManager;
    runtimeEvents;
    pageHooks;
    viewportManager;
    pageManager;
    navigation;
    inputPipeline;
    inputOps;
    fingerprint = null;
    recordingManager;
    onExit;
    exitNotified = false;
    constructor(options) {
        this.options = options;
        const profileId = options.profileId || 'default';
        const root = resolveProfilesRoot();
        this.profileDir = path.join(root, profileId);
        fs.mkdirSync(this.profileDir, { recursive: true });
        this.lock = new ProfileLock(profileId);
        this.recordingManager = new BrowserSessionRecording(profileId, () => this.getCurrentUrl(), () => this.context);
        this.cookiesManager = new BrowserSessionCookies(profileId, () => this.context, () => this.getActivePage());
        this.inputPipeline = new BrowserInputPipeline(() => this.ensurePrimaryPage(), () => this.options.headless === true);
        this.inputOps = new BrowserSessionInputOps(() => this.ensurePrimaryPage(), (page) => this.inputPipeline.ensureInputReady(page), (page, label, run) => this.inputPipeline.runInputAction(page, label, run), (run) => this.inputPipeline.withInputActionLock(run));
        this.viewportManager = new BrowserSessionViewportManager(profileId, () => this.context, () => String(this.options.engine ?? 'camoufox'), () => this.options.headless === true);
        this.runtimeEvents = createRuntimeEventManager(profileId);
        this.pageHooks = createPageHooksManager({
            profileId,
            getRecording: () => this.recordingManager.getRecordingStatus(),
            emitRuntimeEvent: (event) => this.runtimeEvents.emit(event),
            recordPageVisit: (page, reason) => {
                this.lastKnownUrl = page?.url?.() || this.lastKnownUrl;
                this.recordingManager.recordPageVisit(page, reason);
            },
            handleRecorderEvent: (page, evt) => this.recordingManager.handleRecorderEvent(page, evt),
        });
        this.pageManager = new BrowserSessionPageManagement({
            ensureContext: () => this.ensureContext(),
            getActivePage: () => this.getActivePage(),
            getCurrentUrl: () => this.getCurrentUrl(),
            setActivePage: (page) => { this.page = page; },
            setupPageHooks: (page) => this.setupPageHooks(page),
            ensurePageViewport: (page) => this.ensurePageViewport(page),
            maybeCenterPage: (page, viewport) => this.viewportManager.maybeCenter(page, viewport),
            recordLastKnownUrl: (url) => { if (url)
                this.lastKnownUrl = url; },
            isHeadless: () => this.options.headless === true,
        });
        this.navigation = new BrowserSessionNavigation({
            ensurePrimaryPage: () => this.pageManager.ensurePrimaryPage(),
            getActivePage: () => this.getActivePage(),
            recordLastKnownUrl: (url) => { if (url)
                this.lastKnownUrl = url; },
            getLastKnownUrl: () => this.lastKnownUrl,
        });
    }
    get id() {
        return this.options.profileId;
    }
    get currentPage() {
        return this.page;
    }
    get modeName() {
        return this.mode;
    }
    setMode(next = 'dev') {
        this.mode = next === 'run' ? 'run' : 'dev';
    }
    getInfo() {
        return {
            session_id: this.options.profileId,
            profileId: this.options.profileId,
            current_url: this.getCurrentUrl(),
            mode: this.mode,
            headless: !!this.options.headless,
            recording: this.recordingManager.getRecordingStatus(),
        };
    }
    async start(initialUrl) {
        if (!this.lock.acquire()) {
            throw new Error(`无法获取 profile ${this.options.profileId} 的锁`);
        }
        this.cleanupProfileLocks();
        const engine = 'camoufox';
        // 加载或生成指纹（支持 Win/Mac 随机�?
        const fingerprint = await loadOrGenerateFingerprint(this.options.profileId, {
            platform: this.options.fingerprintPlatform || null,
        });
        this.fingerprint = fingerprint;
        logDebug('browser-service', 'session:fingerprint', {
            profileId: this.options.profileId,
            platform: fingerprint.platform,
            userAgent: fingerprint.userAgent?.substring(0, 50) + '...',
        });
        const fallbackViewport = { width: 1440, height: 1100 };
        const explicitViewport = this.options.viewport
            && Number(this.options.viewport.width) > 0
            && Number(this.options.viewport.height) > 0
            ? {
                width: Math.floor(Number(this.options.viewport.width)),
                height: Math.floor(Number(this.options.viewport.height)),
            }
            : null;
        const viewport = explicitViewport || fingerprint?.viewport || fallbackViewport;
        const headless = !!this.options.headless;
        const followWindowViewport = !headless;
        // 使用 EngineManager 启动上下文（Chromium 已移除，仅支�?Camoufox�?
        this.context = await launchEngineContext({
            engine,
            headless,
            profileDir: this.profileDir,
            viewport,
            userAgent: fingerprint?.userAgent,
            locale: 'zh-CN',
            timezoneId: fingerprint?.timezoneId || 'Asia/Shanghai',
        });
        // 应用指纹到上下文（Playwright JS 注入�?
        await applyFingerprint(this.context, fingerprint);
        // NOTE: deviceScaleFactor override was Chromium-only (CDP). Chromium removed.
        this.viewportManager.setInitialViewport(viewport, followWindowViewport);
        this.browser = this.context.browser();
        this.browser.on('disconnected', () => this.notifyExit());
        this.context.on('close', () => this.notifyExit());
        const existing = this.context.pages();
        this.page = existing.length ? existing[0] : await this.context.newPage();
        this.setupPageHooks(this.page);
        this.context.on('page', (p) => this.setupPageHooks(p));
        if (this.viewportManager.isFollowingWindow()) {
            await this.viewportManager.refreshFromWindow(this.page).catch(() => { });
        }
        if (initialUrl) {
            await this.goto(initialUrl);
        }
    }
    setupPageHooks(page) {
        this.pageHooks.setupPageHooks(page);
    }
    addRuntimeEventObserver(observer) {
        return this.runtimeEvents.addObserver(observer);
    }
    getRecordingStatus() {
        return this.recordingManager.getRecordingStatus();
    }
    cleanupProfileLocks() {
        const targets = ['parent.lock', '.startup-incomplete'];
        for (const name of targets) {
            const target = path.join(this.profileDir, name);
            if (!fs.existsSync(target))
                continue;
            try {
                fs.rmSync(target, { force: true });
                logDebug('browser-service', 'profile:cleanup-lock', { profileId: this.options.profileId, file: name });
            }
            catch (error) {
                logDebug('browser-service', 'profile:cleanup-lock-failed', {
                    profileId: this.options.profileId,
                    file: name,
                    error: error?.message || String(error),
                });
            }
        }
    }
    async startRecording(options = {}) {
        this.recordingManager.setBindRecorderBridge((page) => this.pageHooks.bindRecorderBridge(page));
        this.recordingManager.setInstallRecorderRuntime((page, reason) => this.pageHooks.installRecorderRuntime(page, reason));
        return this.recordingManager.startRecording(options);
    }
    async stopRecording(options = {}) {
        return this.recordingManager.stopRecording(options);
    }
    getActivePage() {
        if (this.page && !this.page.isClosed()) {
            return this.page;
        }
        if (!this.context)
            return null;
        const alive = this.context.pages().find((p) => !p.isClosed());
        if (alive) {
            this.page = alive;
            return alive;
        }
        this.page = undefined;
        return null;
    }
    async ensurePageViewport(page) {
        await this.viewportManager.ensurePageViewport(page);
    }
    ensureContext() {
        if (!this.context) {
            throw new Error('browser context not ready');
        }
        return this.context;
    }
    async ensurePrimaryPage() {
        return this.pageManager.ensurePrimaryPage();
    }
    async ensurePage(url) {
        return this.pageManager.ensurePage(url);
    }
    async goBack() {
        return this.navigation.goBack();
    }
    listPages() {
        return this.pageManager.listPages();
    }
    async newPage(url, options = {}) {
        return this.pageManager.newPage(url, options);
    }
    async switchPage(index) {
        return this.pageManager.switchPage(index);
    }
    async closePage(index) {
        return this.pageManager.closePage(index);
    }
    async saveCookiesForActivePage() {
        return this.cookiesManager.saveCookiesForActivePage();
    }
    async getCookies() {
        return this.cookiesManager.getCookies();
    }
    async saveCookiesToFile(filePath) {
        return this.cookiesManager.saveCookiesToFile(filePath);
    }
    async saveCookiesIfStable(filePath, opts = {}) {
        return this.cookiesManager.saveCookiesIfStable(filePath, opts);
    }
    async injectCookiesFromFile(filePath) {
        return this.cookiesManager.injectCookiesFromFile(filePath);
    }
    async goto(url) {
        return this.navigation.goto(url);
    }
    async screenshot(fullPage = true) {
        const page = await this.ensurePrimaryPage();
        return page.screenshot({ fullPage });
    }
    /**
     * 基于屏幕坐标的系统级鼠标点击（Playwright 原生�?
     * @param opts 屏幕坐标及点击选项
     */
    async mouseClick(opts) {
        return this.inputOps.mouseClick(opts);
    }
    /**
     * 基于屏幕坐标的鼠标移动（Playwright 原生�?
     * @param opts 目标坐标及移动选项
     */
    async mouseMove(opts) {
        return this.inputOps.mouseMove(opts);
    }
    /**
     * 基于键盘的系统输入（Playwright keyboard�?
     */
    async keyboardType(opts) {
        return this.inputOps.keyboardType(opts);
    }
    async keyboardPress(opts) {
        return this.inputOps.keyboardPress(opts);
    }
    /**
     * 基于鼠标滚轮的系统滚动（Playwright mouse.wheel�?
     * @param opts deltaY 为垂直滚动（�?向下，负=向上），deltaX 可�?
     */
    async mouseWheel(opts) {
        return this.inputOps.mouseWheel(opts);
    }
    async setViewportSize(opts) {
        const page = await this.ensurePrimaryPage();
        return this.viewportManager.setViewportSize(page, opts);
    }
    async evaluate(expression, arg) {
        const page = await this.ensurePrimaryPage();
        if (typeof arg === 'undefined') {
            return page.evaluate(expression);
        }
        return page.evaluate(expression, arg);
    }
    getCurrentUrl() {
        return this.navigation.getCurrentUrl();
    }
    async close() {
        try {
            await this.stopRecording({ reason: 'session_close' }).catch(() => { });
            await this.context?.close();
        }
        finally {
            await this.browser?.close();
            this.lock.release();
            this.runtimeEvents.clearObservers();
            this.notifyExit();
        }
    }
    notifyExit() {
        if (this.exitNotified)
            return;
        this.exitNotified = true;
        this.onExit?.(this.options.profileId);
    }
}
//# sourceMappingURL=BrowserSession.js.map

