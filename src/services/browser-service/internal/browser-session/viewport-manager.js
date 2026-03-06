import { ensurePageViewport, refreshViewportFromWindow, setViewportSizeOnPage, maybeCenterWindow } from './viewport.js';
export class BrowserSessionViewportManager {
    profileId;
    getContext;
    getEngine;
    isHeadless;
    state = { lastViewport: null, followWindowViewport: false };
    constructor(profileId, getContext, getEngine, isHeadless) {
        this.profileId = profileId;
        this.getContext = getContext;
        this.getEngine = getEngine;
        this.isHeadless = isHeadless;
    }
    setInitialViewport(viewport, followWindowViewport) {
        this.state.followWindowViewport = followWindowViewport;
        this.state.lastViewport = followWindowViewport
            ? null
            : { width: viewport.width, height: viewport.height };
    }
    isFollowingWindow() {
        return this.state.followWindowViewport;
    }
    getLastViewport() {
        return this.state.lastViewport;
    }
    async refreshFromWindow(page) {
        const refreshed = await refreshViewportFromWindow(page).catch(() => null);
        if (refreshed) {
            this.state.lastViewport = refreshed;
        }
    }
    async ensurePageViewport(page) {
        this.state = await ensurePageViewport(page, this.state, this.getContext(), this.getEngine(), this.isHeadless());
    }
    async setViewportSize(page, opts) {
        const next = await setViewportSizeOnPage(page, opts, this.state, this.getContext(), this.getEngine(), this.isHeadless());
        this.state.lastViewport = next;
        return next;
    }
    async maybeCenter(page, fallback) {
        const target = this.state.lastViewport || fallback;
        if (!target)
            return;
        await maybeCenterWindow(page, target, this.isHeadless());
    }
}
//# sourceMappingURL=viewport-manager.js.map