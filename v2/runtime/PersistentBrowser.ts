// 持久浏览器 - 长期运行的浏览器实例
// Profile 绑定，长期保持状态

import { BrowserInstance, BrowserInstanceConfig } from '../resources/browser/BrowserInstance.js';
import { BrowserPool } from '../resources/browser/BrowserPool.js';
import { BrowserPoolRegistry } from '../resources/browser/BrowserPool.js';
import { getCookieStore } from '../core/browser/CookieStore.js';

export interface PersistentBrowserConfig {
  profile: string;           // Profile 名称
  headless?: boolean;
  maxTabs?: number;
  keepAlive?: boolean;
}

export class PersistentBrowser {
  readonly id: string;
  readonly profile: string;
  
  private browser?: BrowserInstance;
  private pool?: BrowserPool;
  private config: PersistentBrowserConfig;
  private running = false;
  private poolRegistry = BrowserPoolRegistry.getInstance();
  private cookieStore = getCookieStore();

  constructor(config: PersistentBrowserConfig) {
    this.id = `persistent-${config.profile}-${Date.now()}`;
    this.profile = config.profile;
    this.config = {
      headless: false,
      maxTabs: 3,
      keepAlive: true,
      ...config,
    };
  }

  // 启动持久浏览器
  async start(): Promise<void> {
    if (this.running) return;
    
    // 创建浏览器实例
    this.browser = new BrowserInstance({
      profile: 'mobile_safari' as any,
      headless: this.config.headless,
    });
    await this.browser.launch();
    
    // 创建关联的 Tab 池
    this.pool = this.poolRegistry.getOrCreatePool(this.profile);
    
    this.running = true;
    console.log(`[PersistentBrowser] Started profile=${this.profile} id=${this.id}`);
  }

  // 获取浏览器实例
  getBrowser(): BrowserInstance | undefined {
    return this.browser;
  }

  // 获取 Tab 池
  getPool(): BrowserPool | undefined {
    return this.pool;
  }

  // 导航
  async navigate(url: string, timeout = 30000): Promise<void> {
    this.ensureRunning();
    this.cookieStore.noteVisit(url);
    await this.browser!.navigate(url, timeout);
  }

  // 截图
  async screenshot(fullPage = false): Promise<string> {
    this.ensureRunning();
    return await this.browser!.screenshot(fullPage);
  }

  // 执行动作
  async execute(action: string, params?: Record<string, unknown>): Promise<unknown> {
    this.ensureRunning();
    
    switch (action) {
      case 'click':
        return await this.browser!.click(params?.selector as string);
      case 'type':
        return await this.browser!.type(params?.selector as string, params?.text as string);
      case 'scroll':
        return await this.browser!.scroll(params?.direction as 'up' | 'down', params?.amount as number);
      case 'getText':
        return await this.browser!.getText(params?.selector as string | undefined);
      case 'getCookies':
        return await this.browser!.getCookies();
      case 'screenshot':
        return await this.screenshot(params?.fullPage as boolean);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  // 注入 Cookie（Netscape 格式）
  async injectCookies(netscapeText: string): Promise<void> {
    this.ensureRunning();
    const imported = this.cookieStore.importNetscape(netscapeText);
    console.log(`[PersistentBrowser] Imported ${imported} cookies for profile=${this.profile}`);
    
    // 重新加载 Cookie 到浏览器
    const domains = this.cookieStore.getBackupDomains();
    for (const domain of domains) {
      const cookies = this.cookieStore.loadCookies(domain);
      if (cookies.length > 0) {
        await this.browser!.setCookies(cookies);
      }
    }
  }

  // 导出 Cookie（Netscape 格式）
  async exportCookies(): Promise<string> {
    this.ensureRunning();
    const cookies = await this.browser!.getCookies();
    return this.cookieStore.exportNetscapeFormat(cookies);
  }

  // 检查是否运行
  isRunning(): boolean {
    return this.running;
  }

  // 停止
  async stop(): Promise<void> {
    if (!this.running) return;
    
    // 保存 Cookie 备份
    try {
      const cookies = await this.browser!.getCookies();
      for (const cookie of cookies) {
        const domain = this.cookieStore.registrableDomain(cookie.domain);
        const existing = this.cookieStore.loadCookies(domain);
        const updated = [...existing.filter(c => c.name !== cookie.name), cookie];
        this.cookieStore.saveCookies(domain, updated);
      }
    } catch (err) {
      console.error(`[PersistentBrowser] Failed to backup cookies:`, err);
    }
    
    // 关闭浏览器
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
    
    // 释放池
    if (this.pool) {
      this.poolRegistry.releasePool(this.profile);
      this.pool = undefined;
    }
    
    this.running = false;
    console.log(`[PersistentBrowser] Stopped profile=${this.profile}`);
  }

  // 强制重启
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  // 状态
  getStatus(): {
    id: string;
    profile: string;
    running: boolean;
    cookies: number;
  } {
    return {
      id: this.id,
      profile: this.profile,
      running: this.running,
      cookies: this.cookieStore.getBackupSummary().cookieCount,
    };
  }

  private ensureRunning(): void {
    if (!this.running) {
      throw new Error(`PersistentBrowser ${this.profile} is not running`);
    }
  }
}

// 持久浏览器管理器
export class PersistentBrowserManager {
  private static instance: PersistentBrowserManager;
  private browsers: Map<string, PersistentBrowser> = new Map();

  private constructor() {}

  static getInstance(): PersistentBrowserManager {
    if (!PersistentBrowserManager.instance) {
      PersistentBrowserManager.instance = new PersistentBrowserManager();
    }
    return PersistentBrowserManager.instance;
  }

  // 创建或获取持久浏览器
  async getOrCreate(profile: string, config?: Partial<PersistentBrowserConfig>): Promise<PersistentBrowser> {
    let browser = this.browsers.get(profile);
    
    if (!browser) {
      browser = new PersistentBrowser({ profile, ...config });
      await browser.start();
      this.browsers.set(profile, browser);
    }
    
    return browser;
  }

  // 获取持久浏览器
  get(profile: string): PersistentBrowser | undefined {
    return this.browsers.get(profile);
  }

  // 列出所有持久浏览器
  list(): Array<{ profile: string; status: ReturnType<PersistentBrowser['getStatus']> }> {
    return Array.from(this.browsers.entries()).map(([profile, browser]) => ({
      profile,
      status: browser.getStatus(),
    }));
  }

  // 停止指定 Profile
  async stop(profile: string): Promise<void> {
    const browser = this.browsers.get(profile);
    if (browser) {
      await browser.stop();
      this.browsers.delete(profile);
    }
  }

  // 停止所有
  async stopAll(): Promise<void> {
    for (const [profile] of this.browsers) {
      await this.stop(profile);
    }
  }
}
