// Browser Instance - Camoufox 封装层

import type { Browser, Page } from 'playwright-core';
import { UserAgentProfile, UA_STRINGS, VIEWPORT_SIZES } from '../../core/browser/Actions.js';

export interface BrowserInstanceConfig {
  profile: UserAgentProfile;
  customUA?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  headless?: boolean;
  proxy?: string;
  proxyPort?: number;
  proxyUsername?: string;
  proxyPassword?: string;
}

export class BrowserInstance {
  private _browser?: Browser;
  private context?: any;
  private page?: Page;
  private config: BrowserInstanceConfig;
  private _isLoading = false;
  private _currentURL = '';
  private _pageTitle = '';
  private closed = false;

  constructor(config: BrowserInstanceConfig) { this.config = config; }

  getUserAgent(): string {
    if (this.config.profile === UserAgentProfile.Custom && this.config.customUA) return this.config.customUA;
    return UA_STRINGS[this.config.profile];
  }

  getViewport(): { width: number; height: number } {
    if (this.config.viewportWidth && this.config.viewportHeight) {
      return { width: this.config.viewportWidth, height: this.config.viewportHeight };
    }
    return VIEWPORT_SIZES[this.config.profile];
  }

  async launch(): Promise<void> {
    if (this._browser || this.closed) return;
    const { Camoufox } = await import('camoufox');
    const viewport = this.getViewport();
    const options: Record<string, any> = { headless: this.config.headless ?? true, locale: 'zh-CN' };
    if (this.config.proxy) {
      options.proxy = { server: `http://${this.config.proxy}:${this.config.proxyPort || 8080}`, username: this.config.proxyUsername, password: this.config.proxyPassword };
    }
    this._browser = (await Camoufox(options)) as unknown as Browser;
    this.context = await this._browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, userAgent: this.getUserAgent() });
    this.page = await this.context.newPage();
    this.setupPageHandlers();
  }

  private setupPageHandlers(): void {
    if (!this.page) return;
    this.page.on('load', () => { this._isLoading = false; });
    this.page.on('framenavigated', (frame: any) => { if (!frame.parentFrame()) { this._currentURL = frame.url(); } });
    
  }

  async navigate(url: string, timeout = 30000): Promise<void> {
    await this.ensureReady();
    this._isLoading = true;
    try {
      await this.page!.goto(url, { timeout, waitUntil: 'domcontentloaded' });
      this._currentURL = url;
    } catch (err) { this._isLoading = false; throw err; }
  }

  async screenshot(fullPage = false): Promise<string> {
    await this.ensureReady();
    const buffer = await this.page!.screenshot({ fullPage, type: 'jpeg', quality: 80 });
    return buffer.toString('base64');
  }

  async click(selector: string): Promise<void> { await this.ensureReady(); await this.page!.locator(selector).click({ timeout: 10000 }); }
  async clickAt(x: number, y: number): Promise<void> { await this.ensureReady(); await this.page!.mouse.click(x, y); }
  async type(selector: string, text: string): Promise<void> { await this.ensureReady(); await this.page!.locator(selector).fill(text, { timeout: 10000 }); }
  
  async getText(selector?: string): Promise<string> {
    await this.ensureReady();
    if (selector) return await this.page!.locator(selector).textContent() || '';
    return await this.page!.textContent('body') || '';
  }

  async scroll(direction: 'up' | 'down', amount = 500): Promise<void> {
    await this.ensureReady();
    const deltaY = direction === 'down' ? amount : -amount;
    await this.page!.evaluate((dy: number) => { (window as any).scrollBy(0, dy); }, deltaY);
  }

  async executeJS(script: string): Promise<unknown> { await this.ensureReady(); return await this.page!.evaluate(script); }

  async getPageInfo(): Promise<{ url: string; title: string; isLoading: boolean }> {
    return { url: this._currentURL || this.page!.url(), title: this._pageTitle || await this.page!.title(), isLoading: this._isLoading };
  }

  async getCookies(): Promise<any[]> { await this.ensureReady(); return await this.context.cookies(); }

  async setCookies(cookies: Array<{ name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; expires?: number }>): Promise<void> {
    await this.ensureReady();
    for (const cookie of cookies) {
      await this.context.addCookies([{
        name: cookie.name, value: cookie.value,
        domain: cookie.domain || new URL(this._currentURL || 'https://example.com').hostname,
        path: cookie.path || '/', secure: cookie.secure ?? true, httpOnly: cookie.httpOnly ?? false, expires: cookie.expires,
      }]);
    }
  }

  async getReadable(): Promise<string> {
    await this.ensureReady();
    return await this.page!.evaluate(() => {
      const doc = document.cloneNode(true) as Document;
      doc.querySelectorAll('script, style, nav, footer, header, aside').forEach((el: Element) => el.remove());
      return doc.body?.textContent?.trim() || '';
    });
  }

  async findElements(selector: string): Promise<string[]> {
    await this.ensureReady();
    const count = await this.page!.locator(selector).count();
    const results: string[] = [];
    for (let i = 0; i < Math.min(count, 100); i++) { results.push(await this.page!.locator(selector).nth(i).textContent() || ''); }
    return results;
  }

  async hover(selector: string): Promise<void> { await this.ensureReady(); await this.page!.locator(selector).hover(); }

  async waitForDomStable(timeout = 5000): Promise<boolean> {
    await this.ensureReady();
    let lastHeight = 0, stableCount = 0;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const height = await this.page!.evaluate(() => (document as any).body.scrollHeight);
      if (height === lastHeight) { stableCount++; if (stableCount >= 3) return true; }
      else { stableCount = 0; lastHeight = height; }
      await this.page!.waitForTimeout(500);
    }
    return false;
  }

  private async ensureReady(): Promise<void> { if (this.closed) throw new Error('Browser instance is closed'); if (!this._browser || !this.page) await this.launch(); }
  get isLoading(): boolean { return this._isLoading; }
  get currentPageURL(): string { return this._currentURL; }
  get pageTitle(): string { return this._pageTitle; }

  async close(): Promise<void> {
    this.closed = true;
    if (this.page) try { await this.page.close(); } catch {}
    if (this.context) try { await this.context.close(); } catch {}
    if (this._browser) try { await this._browser.close(); } catch {}
    this.page = undefined; this.context = undefined; this._browser = undefined;
  }

  getPage(): Page | undefined { return this.page; }
}
