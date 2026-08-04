// Browser Tab Pool - 对标 Openminis BrowserTabPool.swift
// 全局 Tab 池管理，支持多 Session 隔离

import type { BrowserInstance } from './BrowserInstance.js';

export interface BrowserPoolConfig {
  maxTabs: number;           // 单池最大 Tab 数
  globalTabCap: number;       // 全局 Tab 上限
  idleTimeout: number;        // 空闲 Tab 存活时间(ms)
}

export interface TabSnapshot {
  id: number;
  url: string;
  title: string;
  isLoading: boolean;
  inUse: boolean;
  lastActivityAgo: number;
  sessionId: string;
}

export interface PoolSnapshot {
  sessionId: string;
  tabCount: number;
  tabs: TabSnapshot[];
}

const DEFAULT_CONFIG: BrowserPoolConfig = {
  maxTabs: 3,
  globalTabCap: 8,
  idleTimeout: 5 * 60 * 1000, // 5分钟
};

// 全局池注册表
export class BrowserPoolRegistry {
  private static instance: BrowserPoolRegistry;
  private pools: Map<string, BrowserPool> = new Map();
  private config: BrowserPoolConfig;

  private constructor(config: BrowserPoolConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  static getInstance(config?: BrowserPoolConfig): BrowserPoolRegistry {
    if (!BrowserPoolRegistry.instance) {
      BrowserPoolRegistry.instance = new BrowserPoolRegistry(config);
    }
    return BrowserPoolRegistry.instance;
  }

  // 创建或获取池
  getOrCreatePool(sessionId: string): BrowserPool {
    let pool = this.pools.get(sessionId);
    if (!pool) {
      pool = new BrowserPool(sessionId, this.config);
      this.pools.set(sessionId, pool);
    }
    return pool;
  }

  // 释放池
  releasePool(sessionId: string): void {
    const pool = this.pools.get(sessionId);
    if (pool) {
      pool.destroy();
      this.pools.delete(sessionId);
    }
  }

  // 全局 Tab 总数
  totalLiveTabs(): number {
    let total = 0;
    for (const pool of this.pools.values()) {
      total += pool.tabCount;
    }
    return total;
  }

  // 请求槽位（支持跨池抢占）
  requestSlot(requester: BrowserPool): boolean {
    if (this.totalLiveTabs() < this.config.globalTabCap) {
      return true;
    }

    // 找最老的空闲 Tab
    const now = Date.now();
    let oldestIdle: { pool: BrowserPool; tabId: number; idle: number } | null = null;
    let oldestBusy: { pool: BrowserPool; tabId: number; idle: number } | null = null;

    for (const pool of this.pools.values()) {
      if (pool === requester) continue;
      for (const tab of pool.getTabs()) {
        const idle = now - tab.lastActivity;
        if (!tab.inUse) {
          if (!oldestIdle || idle > oldestIdle.idle) {
            oldestIdle = { pool, tabId: tab.id, idle };
          }
        } else {
          if (!oldestBusy || idle > oldestBusy.idle) {
            oldestBusy = { pool, tabId: tab.id, idle };
          }
        }
      }
    }

    if (oldestIdle) {
      oldestIdle.pool.evictTab(oldestIdle.tabId);
      return true;
    }

    if (oldestBusy) {
      oldestBusy.pool.preemptTab(oldestBusy.tabId);
      return true;
    }

    return false;
  }

  // 获取所有池快照
  getAllSnapshots(): PoolSnapshot[] {
    return Array.from(this.pools.entries()).map(([sessionId, pool]) => ({
      sessionId,
      tabCount: pool.tabCount,
      tabs: pool.getTabSnapshots(),
    }));
  }

  // 内存警告处理
  handleMemoryWarning(): void {
    for (const pool of this.pools.values()) {
      pool.evictIdleTabs();
    }
  }
}

// 单个 Session 的 Tab 池
export interface Tab {
  id: number;
  inUse: boolean;
  lastActivity: number;
  url: string;
  title: string;
  browser: BrowserInstance;
}

export class BrowserPool {
  readonly sessionId: string;
  private tabs: Tab[] = [];
  private nextTabId = 1;
  private config: BrowserPoolConfig;
  private idleCleanupTimer?: NodeJS.Timeout;

  constructor(sessionId: string, config: BrowserPoolConfig) {
    this.sessionId = sessionId;
    this.config = config;
    this.startIdleCleanup();
  }

  get tabCount(): number {
    return this.tabs.length;
  }

  getTabs(): Tab[] {
    return [...this.tabs];
  }

  getTabSnapshots(): TabSnapshot[] {
    const now = Date.now();
    return this.tabs.map(tab => ({
      id: tab.id,
      url: tab.url,
      title: tab.title,
      isLoading: tab.browser.isLoading,
      inUse: tab.inUse,
      lastActivityAgo: now - tab.lastActivity,
      sessionId: this.sessionId,
    }));
  }

  // 创建新 Tab
  createTab(browser: BrowserInstance): Tab {
    const tab: Tab = {
      id: this.nextTabId++,
      inUse: false,
      lastActivity: Date.now(),
      url: '',
      title: '',
      browser,
    };
    this.tabs.push(tab);
    return tab;
  }

  // 获取或分配 Tab
  acquireTab(browser: BrowserInstance): Tab | null {
    const registry = BrowserPoolRegistry.getInstance();
    
    // 先找空闲 Tab
    let idleTab = this.tabs.find(t => !t.inUse);
    if (idleTab) {
      idleTab.inUse = true;
      idleTab.lastActivity = Date.now();
      return idleTab;
    }

    // 尝试创建新 Tab
    if (this.tabs.length < this.config.maxTabs) {
      if (registry.requestSlot(this)) {
        const tab = this.createTab(browser);
        tab.inUse = true;
        return tab;
      }
    }

    return null;
  }

  // 释放 Tab
  releaseTab(tabId: number): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.inUse = false;
    }
  }

  // 驱逐空闲 Tab
  evictTab(tabId: number): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx !== -1) {
      const tab = this.tabs[idx];
      if (!tab.inUse) {
        tab.browser.close();
        this.tabs.splice(idx, 1);
      }
    }
  }

  // 抢占 Tab
  preemptTab(tabId: number): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.browser.close();
      const idx = this.tabs.indexOf(tab);
      this.tabs.splice(idx, 1);
    }
  }

  // 驱逐所有空闲 Tab
  evictIdleTabs(): void {
    this.tabs = this.tabs.filter(tab => {
      if (!tab.inUse) {
        tab.browser.close();
        return false;
      }
      return true;
    });
  }

  // 内存警告时驱逐
  evictIdleTabsForMemoryWarning(): number {
    let evicted = 0;
    this.tabs = this.tabs.filter(tab => {
      if (!tab.inUse) {
        tab.browser.close();
        evicted++;
        return false;
      }
      return true;
    });
    return evicted;
  }

  // 更新 Tab 活动
  touchTab(tabId: number, url?: string, title?: string): void {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      tab.lastActivity = Date.now();
      if (url) tab.url = url;
      if (title) tab.title = title;
    }
  }

  // 关闭指定 Tab
  closeTab(tabId: number): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx !== -1) {
      this.tabs[idx].browser.close();
      this.tabs.splice(idx, 1);
    }
  }

  // 关闭所有 Tab
  destroy(): void {
    if (this.idleCleanupTimer) {
      clearInterval(this.idleCleanupTimer);
    }
    for (const tab of this.tabs) {
      tab.browser.close();
    }
    this.tabs = [];
  }

  private startIdleCleanup(): void {
    this.idleCleanupTimer = setInterval(() => {
      const now = Date.now();
      this.tabs = this.tabs.filter(tab => {
        if (!tab.inUse && now - tab.lastActivity > this.config.idleTimeout) {
          tab.browser.close();
          return false;
        }
        return true;
      });
    }, 60000); // 每分钟检查
  }
}
