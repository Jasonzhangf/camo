import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { resolveCookiesRoot } from '../storage-paths.js';
export class BrowserSessionCookies {
    profileId;
    getContext;
    getActivePage;
    lastCookieSignature = null;
    lastCookieSaveTs = 0;
    constructor(profileId, getContext, getActivePage) {
        this.profileId = profileId;
        this.getContext = getContext;
        this.getActivePage = getActivePage;
    }
    async getCookies() {
        const context = this.getContext();
        if (!context)
            return [];
        return context.cookies();
    }
    async saveCookiesForActivePage() {
        const context = this.getContext();
        if (!context)
            return [];
        const page = this.getActivePage();
        if (!page)
            return [];
        const cookies = await context.cookies();
        if (!cookies.length)
            return [];
        const digest = this.hashCookies(cookies);
        const now = Date.now();
        if (digest === this.lastCookieSignature && now - this.lastCookieSaveTs < 2000) {
            return [];
        }
        const targets = this.resolveCookieTargets(page.url());
        if (!targets.length)
            return [];
        const payload = JSON.stringify({
            timestamp: now,
            profileId: this.profileId,
            url: page.url(),
            cookies,
        }, null, 2);
        const results = [];
        for (const target of targets) {
            await fs.promises.mkdir(path.dirname(target), { recursive: true });
            await fs.promises.writeFile(target, payload, 'utf-8');
            results.push({ path: target, count: cookies.length });
        }
        this.lastCookieSignature = digest;
        this.lastCookieSaveTs = now;
        return results;
    }
    async saveCookiesToFile(filePath) {
        const cookies = await this.getCookies();
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify({ timestamp: Date.now(), cookies }, null, 2), 'utf-8');
        return { path: filePath, count: cookies.length };
    }
    async saveCookiesIfStable(filePath, opts = {}) {
        const minDelayMs = Math.max(1000, Number(opts.minDelayMs) || 2000);
        const page = this.getActivePage();
        if (!page)
            return null;
        const html = await page.content();
        const isLoggedIn = html.includes('Frame_wrap_') && !html.includes('LoginCard') && !html.includes('passport');
        if (!isLoggedIn)
            return null;
        const cookies = await this.getCookies();
        if (!cookies.length)
            return null;
        const digest = this.hashCookies(cookies);
        const now = Date.now();
        if (digest === this.lastCookieSignature && now - this.lastCookieSaveTs < minDelayMs) {
            return null;
        }
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, JSON.stringify({ timestamp: now, cookies }, null, 2), 'utf-8');
        this.lastCookieSignature = digest;
        this.lastCookieSaveTs = now;
        return { path: filePath, count: cookies.length };
    }
    async injectCookiesFromFile(filePath) {
        const context = this.getContext();
        if (!context)
            throw new Error('context not ready');
        const raw = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));
        const cookies = Array.isArray(raw) ? raw : Array.isArray(raw?.cookies) ? raw.cookies : [];
        if (!cookies.length)
            return { count: 0 };
        await context.addCookies(cookies);
        return { count: cookies.length };
    }
    resolveCookieTargets(currentUrl) {
        const cookieDir = resolveCookiesRoot();
        const targets = new Set([path.join(cookieDir, `${this.profileId}.json`)]);
        if (currentUrl) {
            try {
                const { hostname } = new URL(currentUrl);
                const hostSegment = this.sanitizeHost(hostname);
                if (hostSegment) {
                    targets.add(path.join(cookieDir, `${hostSegment}-latest.json`));
                }
                if (hostname && hostname.includes('weibo')) {
                    targets.add(path.join(cookieDir, 'weibo.com-latest.json'));
                }
            }
            catch {
                targets.add(path.join(cookieDir, 'default-latest.json'));
            }
        }
        return Array.from(targets);
    }
    sanitizeHost(host) {
        if (!host)
            return 'default';
        return host.replace(/[^a-z0-9.-]/gi, '_');
    }
    hashCookies(cookies) {
        const normalized = cookies
            .map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path,
            expires: c.expires,
            httpOnly: !!c.httpOnly,
            secure: !!c.secure,
        }))
            .sort((a, b) => {
            if (a.domain === b.domain) {
                if (a.name === b.name)
                    return (a.path || '').localeCompare(b.path || '');
                return a.name.localeCompare(b.name);
            }
            return (a.domain || '').localeCompare(b.domain || '');
        });
        const hash = crypto.createHash('sha1');
        hash.update(JSON.stringify(normalized));
        return hash.digest('hex');
    }
}
//# sourceMappingURL=cookies.js.map