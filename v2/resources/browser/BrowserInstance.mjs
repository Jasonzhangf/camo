// Browser Instance - 使用 Camoufox (CJS 导入)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Camoufox } = require('camoufox');
const fs = require('fs');
const path = require('path');

const COOKIE_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'profiles');
const PROFILE_LOCK_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'profile-locks');
// 持久化浏览器数据目录：localStorage/cookie/指纹随 profile 保留，登录态可跨实例恢复
const PROFILE_DATA_DIR = path.join(process.env.HOME || '/tmp', '.camo', 'profiles');

// Profile 多 runtime 锁 - 每 profile 最多 MAX_RUNTIMES 个 runtime
const MAX_RUNTIMES_PER_PROFILE = 2;
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;  // 15 分钟无操作自动关闭

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
  // Camoufox 默认字体集不含 CJK，macOS 下中文会显示为方格。
  // 显式加载系统简体中文字体（按 fontconfig 识别的族名），并固定 zh-CN locale。
  static CJK_FONTS = ['Hiragino Sans GB', 'Heiti SC', 'Songti SC'];
  static DEFAULT_LOCALE = 'zh-CN';
  // 启动窗口尺寸（宽, 高）：显式固定避免随机指纹尺寸/全屏（全屏窗口无可拖拽边缘），
  // 窗口非最大化后可像普通浏览器一样用鼠标拖拽改变大小，viewport 随窗口动态跟随
  static DEFAULT_WINDOW = [1440, 900];
  // 登录墙表单特征（未登录页面才会出现）——登录检测的唯一可靠锚点。
  // 注意：XHS 未登录时导航栏仍含"创作中心/我的/消息"，且登录墙文案为
  // "手机号登录/获取验证码"，不能作为已登录/未登录的判据。
  static LOGIN_PROMPT_ANCHORS = ['扫码登录', '手机号登录', '获取验证码', '登录后推荐'];

  static hasLoginPrompt(bodyText) {
    return BrowserInstance.LOGIN_PROMPT_ANCHORS.some(a => bodyText.includes(a));
  }

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
    this._autoSaveTimer = null;
    this._autoSaveIntervalMs = 60000;  // 常态化 cookie 保存间隔（默认 60s）
    
    // 获取 profile 槽位
    this._profileLockFile = acquireProfileSlot(this.config.profile, process.pid);
    this._resetIdleTimeout();
  }
  
  // 常态化 cookie 保存：活跃期间周期性把当前会话所有域的 cookie 落盘，
  // 与关闭无关（登录后持续保存，不依赖 close 时机）
  startAutoSave(intervalMs = this._autoSaveIntervalMs) {
    this._autoSaveIntervalMs = intervalMs;
    this.stopAutoSave();
    if (!this._browser) return;
    this._autoSaveTimer = setInterval(() => { this._saveAllCookies(); }, intervalMs);
    this._autoSaveTimer.unref?.();
  }
  
  stopAutoSave() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  }
  
  // 取注册域（最后两段）作为分组键：www.xiaohongshu.com 与 .xiaohongshu.com 归入 xiaohongshu.com
  _registrableDomain(domain) {
    const d = this._normalizeDomain(domain);
    if (!d) return '';
    const parts = d.split('.');
    return parts.length > 2 ? parts.slice(-2).join('.') : d;
  }
  
  // 显式全量保存工具：读取当前 context 全部 cookies，按注册域分组写入对应文件。
  // 默认不自动调用——持久化 profile 下浏览器自动写 cookie，手动维护仅用于显式导出。
  async _saveAllCookies() {
    if (!this._browser || this.closed) return;
    try {
      const all = await this._context()?.cookies() || [];
      const byDomain = new Map();
      for (const c of all) {
        const d = this._registrableDomain(c.domain);
        if (!d) continue;
        if (!byDomain.has(d)) byDomain.set(d, []);
        byDomain.get(d).push(c);
      }
      for (const [d, cookies] of byDomain) {
        fs.writeFileSync(this.getCookiePath(d), JSON.stringify(cookies, null, 2));
      }
    } catch {}
  }
  
  _resetIdleTimeout() {
    if (this._idleTimeout) clearTimeout(this._idleTimeout);
    this._idleTimeout = setTimeout(() => {
      console.log(`[BrowserInstance] Idle timeout (${IDLE_TIMEOUT_MS}ms), killing runtime...`);
      this.close();
    }, IDLE_TIMEOUT_MS);
    this._idleTimeout.unref?.();  // 不阻止进程正常退出
  }
  
  _touchActivity() {
    // 仅刷新 profile 锁与 idle 计时，不动 _isLoading（由 navigate 管理加载状态）
    if (this._profileLockFile) touchProfileActivity(this._profileLockFile);
    this._resetIdleTimeout();
  }
  
  // 兼容 Browser（临时 profile）与 BrowserContext（持久化 data_dir）两种启动方式
  _context() {
    if (!this._browser) return null;
    return this._browser.contexts ? this._browser.contexts()[0] : this._browser;
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
    const allCookies = await this._context()?.cookies() || [];
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
      const ctx = this._context();
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
  // 登录检测：直接检测浏览器当前页面状态（cookie 由持久化 profile 自动管理，不注入）
  async checkLoginStatus(url = 'https://www.xiaohongshu.com') {
    if (!this.page) return false;
    // 进入与退出时刷新活动时间，避免长时检查触发 idle 自杀
    this._touchActivity();
    try {
      await this.page.goto(url, { timeout: 15000, waitUntil: 'networkidle' });
      await this.page.waitForTimeout(2000);
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      const hasLoginPrompt = BrowserInstance.hasLoginPrompt(bodyText);
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

  // 按平台登录态 cookie 判定是否已登录（通用能力）。
  // 导航到 url 后，页面无登录墙文案且存在任一给定登录态 cookie 即视为已登录。
  async hasSessionCookies(url, cookieNames = ['web_session', 'web_session_available']) {
    if (!this.page) return false;
    this._touchActivity();
    try {
      await this.page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
      await this.page.waitForTimeout(2000);
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      if (!bodyText.trim()) return false;
      if (BrowserInstance.hasLoginPrompt(bodyText)) return false;
      const cookies = await this._context()?.cookies() || [];
      const hasSession = cookies.some(c => cookieNames.includes(c.name));
      console.log(`[BrowserInstance] Session cookie check: ${hasSession ? 'LOGGED_IN' : 'NOT_LOGGED_IN'}`);
      return hasSession;
    } catch (err) {
      console.log(`[BrowserInstance] Session cookie check failed: ${err.message}`);
      return false;
    } finally {
      this._touchActivity();
    }
  }
  
  async launchWithLogin(domain, loginUrl, opts = {}) {
    const pollMs = opts.pollMs ?? 3000;
    const timeoutMs = opts.timeoutMs ?? 10 * 60 * 1000; // 默认 10 分钟等待登录
    console.log(`[BrowserInstance] === LOGIN REQUIRED ===`);
    console.log(`[BrowserInstance] Launching browser for login...`);
    
    // 登录流程可能远超 idle 超时，期间禁用 idle 自杀，结束后恢复
    if (this._idleTimeout) clearTimeout(this._idleTimeout);
    
    // 复用已有实例（持久化 data_dir 同一 profile 只允许一个实例，重复创建会触发
    // Firefox profile 锁冲突导致启动失败）；无实例时才创建
    if (!this._browser || !this.page) {
      this._browser = await Camoufox({
        headless: false,
        viewport: null,
        window: BrowserInstance.DEFAULT_WINDOW,
        fonts: BrowserInstance.CJK_FONTS,
        locale: BrowserInstance.DEFAULT_LOCALE,
        data_dir: this._profileDataDir(),
      });
      this.page = await this._browser.newPage();
      this.setupHandlers();
    }
    
    await this.page.goto(loginUrl, { timeout: 60000 });
    
    console.log(`[BrowserInstance] Please log in in the browser window (auto-detect, poll ${pollMs}ms, timeout ${Math.round(timeoutMs / 60000)}min)...`);
    
    // 动态轮询扫描登录结果：周期读取当前页，登录墙消失且出现登录态 cookie 即视为登录成功
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      this._touchActivity();
      const loggedIn = await this._detectLoginOnCurrentPage(opts.loginCookieNames, opts.loginPageHosts);
      if (loggedIn) {
        // 登录态由浏览器持久化 profile 自动写入，无需手动保存
        this._resetIdleTimeout();
        console.log(`[BrowserInstance] Login detected for ${domain}, state persisted by browser`);
        return true;
      }
      await this.page.waitForTimeout(pollMs);
    }
    
    console.log(`[BrowserInstance] Login timeout after ${timeoutMs}ms, no login detected`);
    this._resetIdleTimeout();
    return false;
  }
  
  // 只读当前页检测登录状态（不导航），页面导航/加载中返回 false 继续轮询
  // 判定：页面有内容 + 无登录墙 + 存在登录态 cookie（web_session 系列），三者缺一不可，
  // 避免"匿名页无登录墙文案"被误判为登录成功
  async _detectLoginOnCurrentPage(loginCookieNames = ['web_session', 'web_session_available'], loginPageHosts = []) {
    if (!this.page || this.closed) return false;
    try {
      // 当前 URL 命中登录页域名 -> 仍在登录流程，未登录（避免残留 cookie 误判）
      const cur = this.page.url() || '';
      if (loginPageHosts.some(h => cur.includes(h))) return false;
      const bodyText = await this.page.evaluate(() => document.body?.innerText || '');
      // 页面为空/加载失败 -> 未登录（安全默认）
      if (!bodyText.trim()) return false;
      // 有登录墙 -> 未登录
      if (BrowserInstance.hasLoginPrompt(bodyText)) return false;
      // 无登录墙：用登录态 cookie 二次确认（匿名页无 web_session 不算登录）
      const cookies = await this._context()?.cookies() || [];
      return cookies.some(c => loginCookieNames.includes(c.name));
    } catch {
      return false;
    }
  }
  
  // 持久化启动：data_dir 固定到 profile 目录，localStorage/指纹跨实例保留
  _profileDataDir() {
    return path.join(PROFILE_DATA_DIR, this.config.profile, 'browser-data');
  }
  
  async launch() {
    if (this._browser || this.closed) return;
    
    this._browser = await Camoufox({
      headless: this.config.headless ?? true,
      viewport: null,
      screen: null,
      window: BrowserInstance.DEFAULT_WINDOW,
      fonts: BrowserInstance.CJK_FONTS,
      locale: BrowserInstance.DEFAULT_LOCALE,
      data_dir: this._profileDataDir(),
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
  async getCookies() { await this.ensureReady(); this._touchActivity(); return await this._context()?.cookies() || []; }
  async setCookies(cookies) { await this.ensureReady(); this._touchActivity(); if (cookies) { const ctx = this._context(); if (ctx) await ctx.addCookies(cookies); } }
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
    this.stopAutoSave();
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
