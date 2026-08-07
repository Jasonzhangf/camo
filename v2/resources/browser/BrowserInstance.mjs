// Browser Instance - 使用 Camoufox (CJS 导入)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Camoufox } = require('camoufox');
const fs = require('fs');
const path = require('path');

const COOKIE_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'cookies');
const LOCK_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'locks');
const PROFILE_LOCK_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'profile-locks');

// Profile 多 runtime 锁 - 每 profile 最多 MAX_RUNTIMES 个 runtime
const MAX_RUNTIMES_PER_PROFILE = 2;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 分钟无操作自杀

// 获取当前 profile 的活跃 runtime 列表
function getActiveRuntimes(profile) {
  const dir = path.join(PROFILE_LOCK_DIR, profile);
  if (!fs.existsSync(dir)) return [];
  const now = Date.now();
  const active = [];
  for (const file of fs.readdirSync(dir)) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      // 检查进程是否存活且未超时
      try {
        process.kill(data.pid, 0);  // 检查进程
        if (now - data.lastActivity > IDLE_TIMEOUT_MS) {
          // 超时，删除锁
          fs.unlinkSync(path.join(dir, file));
          continue;
        }
        active.push({ ...data, file });
      } catch {
        // 进程已死，删除锁
        fs.unlinkSync(path.join(dir, file));
      }
    } catch {}
  }
  return active;
}

function acquireProfileSlot(profile, pid) {
  const dir = path.join(PROFILE_LOCK_DIR, profile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  // 清理过期锁
  getActiveRuntimes(profile);
  
  // 先写锁再回查数量，超限即回滚删除（避免检查-写入竞态突破上限）
  const lockFile = path.join(dir, `${pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.lock`);
  fs.writeFileSync(lockFile, JSON.stringify({
    pid,
    profile,
    createdAt: Date.now(),
    lastActivity: Date.now()
  }));
  
  const active = getActiveRuntimes(profile);
  if (active.length > MAX_RUNTIMES_PER_PROFILE) {
    try { fs.unlinkSync(lockFile); } catch {}
    throw new Error(`E_PROFILE_LIMIT: Profile "${profile}" has ${active.length} active runtimes (max ${MAX_RUNTIMES_PER_PROFILE})`);
  }
  return lockFile;
}

function releaseProfileSlot(lockFile) {
  try { if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile); } catch {}
}

function touchProfileActivity(lockFile) {
  try {
    if (fs.existsSync(lockFile)) {
      const data = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      data.lastActivity = Date.now();
      fs.writeFileSync(lockFile, JSON.stringify(data));
    }
  } catch {}
}

export class BrowserInstance {
  constructor(config = {}) {
    this.config = {
      profile: 'default',
      headless: true,
      ...config
    };
    // profile 白名单校验：拒绝路径穿越（..）、绝对路径与非法字符
    const pid = String(this.config.profile || '');
    if (!/^[a-zA-Z0-9_-]+$/.test(pid)) {
      throw new Error(`E_INVALID_PROFILE: profile must match ^[a-zA-Z0-9_-]+$, got "${pid}"`);
    }
    this._browser = null;
    this.page = null;
    this._isLoading = false;
    this._currentURL = '';
    this._pageTitle = '';
    this.closed = false;
    this._profileLockFile = null;
    this._idleTimeout = null;
    
    // 获取 profile 槽位
    this._profileLockFile = acquireProfileSlot(this.config.profile, process.pid);
    this._resetIdleTimeout();
  }
  
  _resetIdleTimeout() {
    if (this._idleTimeout) clearTimeout(this._idleTimeout);
    this._idleTimeout = setTimeout(() => {
      console.log(`[BrowserInstance] Idle timeout (${IDLE_TIMEOUT_MS}ms), killing runtime...`);
      this.close();
    }, IDLE_TIMEOUT_MS);
  }
  
  _touchActivity() {
    // 仅刷新 profile 锁与 idle 计时，不动 _isLoading（由 navigate 管理加载状态）
    if (this._profileLockFile) touchProfileActivity(this._profileLockFile);
    this._resetIdleTimeout();
  }
  
  getCookieDir() {
    const dir = path.join(COOKIE_DIR, this.config.profile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  
  // 规范化域名：去前导点，用于文件名与匹配
  _normalizeDomain(domain) {
    if (!domain) return '';
    return String(domain).startsWith('.') ? String(domain).slice(1) : String(domain);
  }
  
  // 判断 cookie.domain 是否属于目标 domain（含子域）
  _cookieMatchesDomain(cookieDomain, targetDomain) {
    const cd = this._normalizeDomain(cookieDomain);
    const td = this._normalizeDomain(targetDomain);
    if (!cd || !td) return false;
    return cd === td || cd.endsWith('.' + td);
  }
  
  getCookiePath(domain) {
    return path.join(this.getCookieDir(), `${this._normalizeDomain(domain)}.json`);
  }
  
  async saveCookies(domain) {
    if (!this._browser) return;
    const target = this._normalizeDomain(domain);
    if (!target) return;
    // 只保存属于该 domain 的 cookies（含子域），文件名与内容一致
    const allCookies = await this._browser.contexts()[0]?.cookies() || [];
    const cookies = allCookies.filter(c => this._cookieMatchesDomain(c.domain, target));
    const p = this.getCookiePath(target);
    if (cookies.length === 0) {
      // 无该域 cookie 时删除旧文件，避免登出后残留过期 cookie 被重新加载
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        console.log(`[BrowserInstance] No cookies for ${target}, removed stale file`);
      }
      return;
    }
    fs.writeFileSync(p, JSON.stringify(cookies, null, 2));
    console.log(`[BrowserInstance] Saved ${cookies.length} cookies for ${target}`);
  }
  
  async loadCookies(domain) {
    const dir = this.getCookieDir();
    // 同时支持 .json 和 .txt (Netscape) 格式，统一用规范化 domain 命名
    const target = this._normalizeDomain(domain);
    if (!target) return false;
    const jsonPath = path.join(dir, `${target}.json`);
    const txtPath = path.join(dir, `${target}.txt`);
    
    let cookies = null;
    if (fs.existsSync(jsonPath)) {
      try { cookies = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); }
      catch (err) { console.log(`[BrowserInstance] Load cookie (json) failed: ${err.message}`); }
    }
    if ((!cookies || cookies.length === 0) && fs.existsSync(txtPath)) {
      try { cookies = this._parseNetscape(fs.readFileSync(txtPath, 'utf8')); }
      catch (err) { console.log(`[BrowserInstance] Load cookie (txt) failed: ${err.message}`); }
    }
    
    if (cookies && cookies.length > 0 && this._browser) {
      const ctx = this._browser.contexts()[0];
      if (ctx) {
        // 修正 domain 格式（缺 domain 字段的 cookie 跳过，避免 addCookies 崩溃）
        const fixed = cookies
          .filter(c => c && typeof c.domain === 'string' && c.domain.length > 0)
          .map(c => ({
            ...c,
            domain: c.domain.startsWith('.') ? c.domain.slice(1) : c.domain,
            expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires : -1
          }));
        await ctx.addCookies(fixed);
        console.log(`[BrowserInstance] Loaded ${fixed.length} cookies for ${target}`);
        return true;
      }
    }
    return false;
  }
  
  _parseNetscape(text) {
    const cookies = [];
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const fields = trimmed.split('\t');
      if (fields.length !== 7) continue;
      const [domain, includeSubdomains, cookiePath, secure, expiry, name, value] = fields;
      cookies.push({
        name, value, domain,
        path: cookiePath || '/',
        expires: parseInt(expiry) || -1,
        secure: secure === 'TRUE',
        sameSite: 'None'
      });
    }
    return cookies;
  }
  
  // 检查是否需要登录（通过主页判断）
  async checkLoginStatus(url = 'https://www.xiaohongshu.com') {
    if (!this.page) return false;
    // 进入与退出时刷新活动时间，避免长时检查触发 idle 自杀
    this._touchActivity();
    try {
      // 重新加载 cookie 后再检查（规范化域名，兼容 .json/.txt）
      await this.loadCookies(this._normalizeDomain('xiaohongshu.com'));
      await this.page.goto(url, { timeout: 15000, waitUntil: 'networkidle' });
      await this.page.waitForTimeout(2000);
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      // 登录判定的可靠锚点：登录墙表单特征（未登录页面才会出现）。
      // 注意：XHS 未登录时导航栏仍含"创作中心/我的/消息"，且登录墙文案为
      // "手机号登录/获取验证码"，不能作为已登录/未登录的判据。
      const hasLoginPrompt = bodyText.includes('扫码登录')
        || bodyText.includes('手机号登录')
        || bodyText.includes('获取验证码')
        || bodyText.includes('登录后推荐');
      // 页面内容正常加载且无登录墙 = 已登录；页面为空/加载失败 = 未登录（安全默认）
      const isLoggedIn = bodyText.trim().length > 0 && !hasLoginPrompt;
      if (!bodyText.trim()) { console.log('[BrowserInstance] Page body empty, treat as not logged in'); }
      else if (hasLoginPrompt) { console.log('[BrowserInstance] Detected login prompt, not logged in'); }
      console.log(`[BrowserInstance] Login status: ${isLoggedIn ? 'LOGGED_IN' : 'NOT_LOGGED_IN'}`);
      return isLoggedIn;
    } catch (err) {
      console.log(`[BrowserInstance] Login check failed: ${err.message}`);
      return false;
    } finally {
      this._touchActivity();
    }
  }
  
  async launchWithLogin(domain, loginUrl) {
    console.log(`[BrowserInstance] === LOGIN REQUIRED ===`);
    console.log(`[BrowserInstance] Launching browser for login...`);
    
    // 登录流程可能远超 idle 超时，期间禁用 idle 自杀，结束后恢复
    if (this._idleTimeout) clearTimeout(this._idleTimeout);
    
    this._browser = await Camoufox({ headless: false, viewport: null });
    this.page = await this._browser.newPage();
    this.setupHandlers();
    
    await this.page.goto(loginUrl, { timeout: 60000 });
    
    console.log(`[BrowserInstance] Please log in in the browser window`);
    console.log(`[BrowserInstance] Press Enter after login complete...`);
    
    await new Promise(resolve => { process.stdin.once('data', () => resolve()); });
    
    // 保存登录状态
    await this.saveCookies(domain);
    this._resetIdleTimeout();
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
    this._touchActivity();
    try {
      await this.page.goto(url, { timeout, waitUntil: 'domcontentloaded' });
      this._currentURL = url;
    } catch (err) { this._isLoading = false; throw err; }
  }
  
  async screenshot(fullPage = false) {
    await this.ensureReady();
    this._touchActivity();
    const buffer = await this.page.screenshot({ fullPage, type: 'jpeg', quality: 80 });
    return buffer.toString('base64');
  }
  
  async click(selector) { await this.ensureReady(); this._touchActivity(); await this.page.locator(selector).click({ timeout: 10000 }); }
  async clickAt(x, y) { await this.ensureReady(); this._touchActivity(); await this.page.mouse.click(x, y); }
  async type(selector, text) { await this.ensureReady(); this._touchActivity(); await this.page.locator(selector).fill(text, { timeout: 10000 }); }
  async getText(selector) { await this.ensureReady(); this._touchActivity(); return selector ? await this.page.locator(selector).textContent() || '' : await this.page.textContent('body') || ''; }
  async scroll(direction, amount = 500) { await this.ensureReady(); this._touchActivity(); const deltaY = direction === 'down' ? amount : -amount; await this.page.evaluate((dy) => { window.scrollBy(0, dy); }, deltaY); }
  async executeJS(script) { await this.ensureReady(); this._touchActivity(); return await this.page.evaluate(script); }
  async getCookies() { await this.ensureReady(); this._touchActivity(); return await this._browser.contexts()[0]?.cookies() || []; }
  async setCookies(cookies) { await this.ensureReady(); this._touchActivity(); if (cookies) { const ctx = this._browser.contexts()[0]; if (ctx) await ctx.addCookies(cookies); } }
  async getReadable() { await this.ensureReady(); this._touchActivity(); return await this.page.evaluate(() => { const doc = document.cloneNode(true); doc.querySelectorAll('script, style, nav, footer, header, aside').forEach(el => el.remove()); return doc.body?.textContent?.trim() || ''; }); }
  async findElements(selector) { await this.ensureReady(); this._touchActivity(); const count = await this.page.locator(selector).count(); const results = []; for (let i = 0; i < Math.min(count, 100); i++) results.push(await this.page.locator(selector).nth(i).textContent() || ''); return results; }
  async hover(selector) { await this.ensureReady(); this._touchActivity(); await this.page.locator(selector).hover(); }
  async waitForDomStable(timeout = 5000) { await this.ensureReady(); this._touchActivity(); let lastHeight = 0, stableCount = 0; const start = Date.now(); while (Date.now() - start < timeout) { const height = await this.page.evaluate(() => document.body.scrollHeight); if (height === lastHeight) { if (++stableCount >= 3) return true; } else { stableCount = 0; lastHeight = height; } await this.page.waitForTimeout(500); } return false; }
  
  async ensureReady() { if (this.closed) throw new Error('Browser instance is closed'); if (!this._browser || !this.page) await this.launch(); }
  
  get isLoading() { return this._isLoading; }
  get currentPageURL() { return this._currentURL; }
  get pageTitle() { return this._pageTitle; }
  
  async close() {
    // 无条件置位：即使从未 launch，实例也不可再被 ensureReady 复活
    this.closed = true;
    if (this._idleTimeout) {
      clearTimeout(this._idleTimeout);
      this._idleTimeout = null;
    }
    if (this._profileLockFile) {
      releaseProfileSlot(this._profileLockFile);
      this._profileLockFile = null;
    }
    if (this._browser) {
      try { if (this.page) await this.page.close(); } catch {}
      try { await this._browser.close(); } catch {}
      this.page = null;
      this._browser = null;
    }
  }
}
