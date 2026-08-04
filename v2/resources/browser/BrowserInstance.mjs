// Browser Instance - 使用 Firefox (通过 Camoufox 路径)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { firefox } = require('playwright-core');
const { getLaunchPath } = require('camoufox');

export class BrowserInstance {
  constructor(config = {}) {
    this.config = {
      profile: 'mobile_safari',
      headless: true,
      ...config
    };
    this._browser = null;
    this._context = null;
    this.page = null;
    this._isLoading = false;
    this._currentURL = '';
    this._pageTitle = '';
    this.closed = false;
  }
  
  getUserAgent() {
    if (this.config.profile === 'custom' && this.config.customUA) return this.config.customUA;
    const UAs = {
      desktop_safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
      mobile_safari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
    };
    return UAs[this.config.profile] || UAs.mobile_safari;
  }
  
  async launch() {
    if (this._browser || this.closed) return;
    
    const executablePath = getLaunchPath();
    
    this._browser = await firefox.launch({
      headless: this.config.headless ?? true,
      executablePath,
    });
    
    this.page = await this._browser.newPage();
    this.setupHandlers();
  }
  
  setupHandlers() {
    if (!this.page) return;
    this.page.on('load', () => { this._isLoading = false; });
    this.page.on('framenavigated', (frame) => {
      if (!frame.parentFrame()) this._currentURL = frame.url();
    });
    this.page.on('close', () => { this.closed = true; });
    this.page.on('console', (msg) => {
      // 转发 console 到 Node.js
      console.log('[Browser]', msg.type(), msg.text());
    });
  }
  
  async navigate(url, timeout = 30000) {
    await this.ensureReady();
    this._isLoading = true;
    try {
      await this.page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
      this._currentURL = url;
    } catch (err) {
      this._isLoading = false;
      throw err;
    }
  }
  
  async screenshot(fullPage = false) {
    await this.ensureReady();
    const buffer = await this.page.screenshot({ fullPage, type: 'jpeg', quality: 80 });
    return buffer.toString('base64');
  }
  
  async click(selector) {
    await this.ensureReady();
    await this.page.locator(selector).click({ timeout: 10000 });
  }
  
  async clickAt(x, y) {
    await this.ensureReady();
    await this.page.mouse.click(x, y);
  }
  
  async type(selector, text) {
    await this.ensureReady();
    await this.page.locator(selector).fill(text, { timeout: 10000 });
  }
  
  async getText(selector) {
    await this.ensureReady();
    if (selector) return await this.page.locator(selector).textContent() || '';
    return await this.page.textContent('body') || '';
  }
  
  async scroll(direction, amount = 500) {
    await this.ensureReady();
    const deltaY = direction === 'down' ? amount : -amount;
    await this.page.evaluate((dy) => { window.scrollBy(0, dy); }, deltaY);
  }
  
  async executeJS(script) {
    await this.ensureReady();
    // 使用 page.evaluate 直接返回结果，不捕获错误
    return await this.page.evaluate(script);
  }
  
  async getPageInfo() {
    return {
      url: this._currentURL || this.page.url(),
      title: this._pageTitle || await this.page.title(),
      isLoading: this._isLoading
    };
  }
  
  async getCookies() {
    await this.ensureReady();
    return await this.page.context().cookies();
  }
  
  async setCookies(cookies) {
    await this.ensureReady();
    if (cookies) {
      await this.page.context().addCookies(cookies);
    }
  }
  
  async getReadable() {
    await this.ensureReady();
    return await this.page.evaluate(() => {
      const doc = document.cloneNode(true);
      doc.querySelectorAll('script, style, nav, footer, header, aside').forEach(el => el.remove());
      return doc.body?.textContent?.trim() || '';
    });
  }
  
  async findElements(selector) {
    await this.ensureReady();
    const count = await this.page.locator(selector).count();
    const results = [];
    for (let i = 0; i < Math.min(count, 100); i++) {
      results.push(await this.page.locator(selector).nth(i).textContent() || '');
    }
    return results;
  }
  
  async hover(selector) {
    await this.ensureReady();
    await this.page.locator(selector).hover();
  }
  
  async waitForDomStable(timeout = 5000) {
    await this.ensureReady();
    let lastHeight = 0, stableCount = 0;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const height = await this.page.evaluate(() => document.body.scrollHeight);
      if (height === lastHeight) {
        if (++stableCount >= 3) return true;
      } else {
        stableCount = 0;
        lastHeight = height;
      }
      await this.page.waitForTimeout(500);
    }
    return false;
  }
  
  async ensureReady() {
    if (this.closed) throw new Error('Browser instance is closed');
    if (!this._browser || !this.page) await this.launch();
  }
  
  get isLoading() { return this._isLoading; }
  get currentPageURL() { return this._currentURL; }
  get pageTitle() { return this._pageTitle; }
  
  async close() {
    this.closed = true;
    if (this.page) try { await this.page.close(); } catch {}
    if (this._browser) try { await this._browser.close(); } catch {}
    this.page = null;
    this._browser = null;
  }
}
