// 临时浏览器 - 对标 Openminis 的临时任务模式
// 自动清理 TTL，避免僵尸资源

import { BrowserInstance, BrowserInstanceConfig } from '../resources/browser/BrowserInstance.js';
import { BrowserPool } from '../resources/browser/BrowserPool.js';
import { BrowserPoolRegistry } from '../resources/browser/BrowserPool.js';

export interface TransientBrowserConfig {
  ttl: number;           // 存活时间(ms)
  idleTimeout: number;   // 空闲超时(ms)
  autoCleanup: boolean;  // 自动清理
}

const DEFAULT_CONFIG: TransientBrowserConfig = {
  ttl: 5 * 60 * 1000,       // 5分钟
  idleTimeout: 60 * 1000,    // 1分钟空闲
  autoCleanup: true,
};

export class TransientBrowser {
  readonly id: string;
  private browser?: BrowserInstance;
  private config: TransientBrowserConfig;
  private createdAt: number;
  private lastUsedAt: number;
  private destroyed = false;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: Partial<TransientBrowserConfig> = {}) {
    this.id = `transient-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.createdAt = Date.now();
    this.lastUsedAt = this.createdAt;
    
    if (this.config.autoCleanup) {
      this.startCleanupTimer();
    }
  }

  // 获取或创建浏览器
  async getBrowser(config?: BrowserInstanceConfig): Promise<BrowserInstance> {
    this.checkDestroyed();
    this.touch();
    
    if (!this.browser) {
      this.browser = new BrowserInstance(config || { headless: true, profile: 'mobile_safari' as any });
      await this.browser.launch();
    }
    
    return this.browser;
  }

  // 标记使用
  touch(): void {
    this.lastUsedAt = Date.now();
  }

  // 检查是否过期
  isExpired(): boolean {
    return Date.now() - this.createdAt > this.config.ttl;
  }

  // 检查是否空闲
  isIdle(): boolean {
    return Date.now() - this.lastUsedAt > this.config.idleTimeout;
  }

  // 销毁
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }

  // 状态
  getStatus(): { id: string; alive: boolean; expired: boolean; idle: boolean; age: number } {
    return {
      id: this.id,
      alive: !this.destroyed,
      expired: this.isExpired(),
      idle: this.isIdle(),
      age: Date.now() - this.createdAt,
    };
  }

  private checkDestroyed(): void {
    if (this.destroyed) {
      throw new Error(`TransientBrowser ${this.id} is already destroyed`);
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setTimeout(async () => {
      if (this.destroyed) return;
      
      if (this.isExpired() || this.isIdle()) {
        console.log(`[TransientBrowser] Auto-destroying ${this.id} (expired=${this.isExpired()}, idle=${this.isIdle()})`);
        await this.destroy();
      } else {
        // 继续检查
        this.startCleanupTimer();
      }
    }, Math.min(this.config.idleTimeout, 30000)); // 最少30秒检查一次
  }
}

// 临时浏览器管理器
export class TransientBrowserManager {
  private static instance: TransientBrowserManager;
  private browsers: Map<string, TransientBrowser> = new Map();
  private gcTimer?: NodeJS.Timeout;

  private constructor() {
    this.startGC();
  }

  static getInstance(): TransientBrowserManager {
    if (!TransientBrowserManager.instance) {
      TransientBrowserManager.instance = new TransientBrowserManager();
    }
    return TransientBrowserManager.instance;
  }

  // 创建临时浏览器
  create(config?: Partial<TransientBrowserConfig>): TransientBrowser {
    const browser = new TransientBrowser(config);
    this.browsers.set(browser.id, browser);
    return browser;
  }

  // 获取临时浏览器
  get(id: string): TransientBrowser | undefined {
    return this.browsers.get(id);
  }

  // 销毁临时浏览器
  async destroy(id: string): Promise<void> {
    const browser = this.browsers.get(id);
    if (browser) {
      await browser.destroy();
      this.browsers.delete(id);
    }
  }

  // 列出所有临时浏览器
  list(): Array<{ id: string; status: ReturnType<TransientBrowser['getStatus']> }> {
    return Array.from(this.browsers.values()).map(b => ({
      id: b.id,
      status: b.getStatus(),
    }));
  }

  // GC 清理
  private async gc(): Promise<void> {
    const toDestroy: string[] = [];
    
    for (const [id, browser] of this.browsers) {
      if (browser.isExpired() || browser.isIdle()) {
        toDestroy.push(id);
      }
    }
    
    for (const id of toDestroy) {
      await this.destroy(id);
    }
    
    if (toDestroy.length > 0) {
      console.log(`[TransientBrowserManager] GC cleaned ${toDestroy.length} browsers`);
    }
  }

  private startGC(): void {
    this.gcTimer = setInterval(() => {
      this.gc();
    }, 60000); // 每分钟 GC
  }
}
