// Browser Instance - 使用 Camoufox (CJS 导入)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Camoufox } = require('/Users/fanzhang/Documents/github/camo/node_modules/camoufox/dist/index.cjs');
const fs = require('fs');
const path = require('path');

const COOKIE_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'cookies');

export class BrowserInstance {
  constructor(config = {}) {
    this.config = {
      profile: 'default',
      headless: true,  // 默认无头
      ...config
    };
    this._browser = null;
    this.page = null;
    this._isLoading = false;
    this._currentURL = '';
    this._pageTitle = '';
    this.closed = false;
  }
  
  getCookiePath(domain) {
    const dir = path.join(COOKIE_DIR, this.config.profile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${domain}.json`);
  }
  
  async saveCookies(domain) {
    if (!this._browser) return;
    const cookies = await this._browser.contexts()[0]?.cookies();
    if (cookies) {
      fs.writeFileSync(this.getCookiePath(domain), JSON.stringify(cookies, null, 2));
      console.log(`[BrowserInstance] Saved ${cookies.length} cookies`);
    }
  }
  
  async loadCookies(domain) {
    const cookiePath = this.getCookiePath(domain);
    if (fs.existsSync(cookiePath)) {
      const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
      if (this._browser && cookies.length > 0) {
        const ctx = this._browser.contexts()[0];
        if (ctx) { await ctx.addCookies(cookies); return true; }
      }
    }
    return false;
  }
  
  // 检查是否需要登录（通过主页判断）
  async checkLoginStatus(url = 'https://www.xiaohongshu.com') {
    if (!this.page) return false;
    try {
      // 重新加载 cookie 后再检查
      const domains = ['xiaohongshu.com', '.xiaohongshu.com'];
      for (const d of domains) {
        await this.loadCookies(d);
      }
      await this.page.goto(url, { timeout: 15000, waitUntil: 'networkidle' });
      await this.page.waitForTimeout(2000);
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      // 主页没有登录提示说明已登录
      // 正确逻辑：有"创作中心"/"我的"/"消息"等登录后元素，且不包含"扫码登录"弹窗
      const hasLoginPrompt = bodyText.includes('扫码登录');
      const hasLoggedInUI = bodyText.includes('创作中心') || bodyText.includes('我的') || bodyText.includes('消息');
      const isLoggedIn = !hasLoginPrompt || hasLoggedInUI;
      if (hasLoginPrompt && !hasLoggedInUI) { console.log('[BrowserInstance] Detected login popup, not logged in'); }
      console.log(`[BrowserInstance] Login status: ${isLoggedIn ? 'LOGGED_IN' : 'NOT_LOGGED_IN'}`);
      return isLoggedIn;
    } catch (err) {
      console.log(`[BrowserInstance] Login check failed: ${err.message}`);
      return false;
    }
  }
  
  async launchWithLogin(domain, loginUrl) {
    console.log(`[BrowserInstance] === LOGIN REQUIRED ===`);
    console.log(`[BrowserInstance] Launching browser for login...`);
    
    this._browser = await Camoufox({ headless: false, viewport: null });
    this.page = await this._browser.newPage();
    this.setupHandlers();
    
    await this.page.goto(loginUrl, { timeout: 60000 });
    
    console.log(`[BrowserInstance] Please log in in the browser window`);
    console.log(`[BrowserInstance] Press Enter after login complete...`);
    
    await new Promise(resolve => { process.stdin.once('data', () => resolve()); });
    
    // 保存登录状态
    await this.saveCookies(domain);
    console.log(`[BrowserInstance] Login successful, cookies saved`);
    
    return true;
  }
  
  async launch() {
    if (this._browser || this.closed) return;
    
    this._browser = await Camoufox({
      headless: this.config.headless ?? true,
      viewport: null,
      screen: null,
    });
    
    this.page = await this._browser.newPage();
    this.setupHandlers();
  }
  
  setupHandlers() {
    if (!this.page) return;
    this.page.on('load', () => { this._isLoading = false; });
    this.page.on('framenavigated', (frame) => { if (!frame.parentFrame()) this._currentURL = frame.url(); });
    this.page.on('close', () => { this.closed = true; });
  }
  
  async navigate(url, timeout = 30000) {
    await this.ensureReady();
    this._isLoading = true;
    try {
      await this.page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
      this._currentURL = url;
    } catch (err) { this._isLoading = false; throw err; }
  }
  
  async screenshot(fullPage = false) {
    await this.ensureReady();
    const buffer = await this.page.screenshot({ fullPage, type: 'jpeg', quality: 80 });
    return buffer.toString('base64');
  }
  
  async click(selector) { await this.ensureReady(); await this.page.locator(selector).click({ timeout: 10000 }); }
  async clickAt(x, y) { await this.ensureReady(); await this.page.mouse.click(x, y); }
  async type(selector, text) { await this.ensureReady(); await this.page.locator(selector).fill(text, { timeout: 10000 }); }
  async getText(selector) { await this.ensureReady(); return selector ? await this.page.locator(selector).textContent() || '' : await this.page.textContent('body') || ''; }
  async scroll(direction, amount = 500) { await this.ensureReady(); const deltaY = direction === 'down' ? amount : -amount; await this.page.evaluate((dy) => { window.scrollBy(0, dy); }, deltaY); }
  async executeJS(script) { await this.ensureReady(); return await this.page.evaluate(script); }
  async getPageInfo() { return { url: this._currentURL || this.page.url(), title: await this.page.title(), isLoading: this._isLoading }; }
  async getCookies() { await this.ensureReady(); return await this._browser.contexts()[0]?.cookies() || []; }
  async setCookies(cookies) { await this.ensureReady(); if (cookies) { const ctx = this._browser.contexts()[0]; if (ctx) await ctx.addCookies(cookies); } }
  async getReadable() { await this.ensureReady(); return await this.page.evaluate(() => { const doc = document.cloneNode(true); doc.querySelectorAll('script, style, nav, footer, header, aside').forEach(el => el.remove()); return doc.body?.textContent?.trim() || ''; }); }
  async findElements(selector) { await this.ensureReady(); const count = await this.page.locator(selector).count(); const results = []; for (let i = 0; i < Math.min(count, 100); i++) results.push(await this.page.locator(selector).nth(i).textContent() || ''); return results; }
  async hover(selector) { await this.ensureReady(); await this.page.locator(selector).hover(); }
  async waitForDomStable(timeout = 5000) { await this.ensureReady(); let lastHeight = 0, stableCount = 0; const start = Date.now(); while (Date.now() - start < timeout) { const height = await this.page.evaluate(() => document.body.scrollHeight); if (height === lastHeight) { if (++stableCount >= 3) return true; } else { stableCount = 0; lastHeight = height; } await this.page.waitForTimeout(500); } return false; }
  
  async ensureReady() { if (this.closed) throw new Error('Browser instance is closed'); if (!this._browser || !this.page) await this.launch(); }
  
  get isLoading() { return this._isLoading; }
  get currentPageURL() { return this._currentURL; }
  get pageTitle() { return this._pageTitle; }
  
  async close() { this.closed = true; if (this.page) try { await this.page.close(); } catch {} if (this._browser) try { await this._browser.close(); } catch {} this.page = null; this._browser = null; }
}
