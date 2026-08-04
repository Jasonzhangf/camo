// Browser Tab Pool - 全局 Tab 池管理

const DEFAULT_CONFIG = {
  maxTabs: 3,
  globalTabCap: 8,
  idleTimeout: 5 * 60 * 1000,
};

class BrowserPoolRegistry {
  constructor(config = DEFAULT_CONFIG) {
    this.config = config;
    this.pools = new Map();
  }
  
  static _instance = null;
  static getInstance() {
    if (!BrowserPoolRegistry._instance) {
      BrowserPoolRegistry._instance = new BrowserPoolRegistry();
    }
    return BrowserPoolRegistry._instance;
  }
  
  getOrCreatePool(sessionId) {
    let pool = this.pools.get(sessionId);
    if (!pool) {
      pool = new BrowserPool(sessionId, this.config);
      this.pools.set(sessionId, pool);
    }
    return pool;
  }
  
  releasePool(sessionId) {
    const pool = this.pools.get(sessionId);
    if (pool) { pool.destroy(); this.pools.delete(sessionId); }
  }
  
  totalLiveTabs() {
    let total = 0;
    for (const pool of this.pools.values()) { total += pool.tabCount; }
    return total;
  }
  
  getAllSnapshots() {
    return Array.from(this.pools.entries()).map(([sessionId, pool]) => ({
      sessionId, tabCount: pool.tabCount, tabs: pool.getTabSnapshots(),
    }));
  }
}

class BrowserPool {
  constructor(sessionId, config) {
    this.sessionId = sessionId;
    this.config = config;
    this.tabs = [];
    this.nextTabId = 1;
  }
  
  get tabCount() { return this.tabs.length; }
  
  getTabs() { return [...this.tabs]; }
  
  getTabSnapshots() {
    const now = Date.now();
    return this.tabs.map(tab => ({
      id: tab.id, url: tab.url, title: tab.title,
      isLoading: tab.browser?.isLoading || false,
      inUse: tab.inUse, lastActivityAgo: now - tab.lastActivity, sessionId: this.sessionId,
    }));
  }
  
  createTab(browser) {
    const tab = { id: this.nextTabId++, inUse: false, lastActivity: Date.now(), url: '', title: '', browser };
    this.tabs.push(tab);
    return tab;
  }
  
  acquireTab(browser) {
    let idleTab = this.tabs.find(t => !t.inUse);
    if (idleTab) { idleTab.inUse = true; idleTab.lastActivity = Date.now(); return idleTab; }
    if (this.tabs.length < this.config.maxTabs) {
      const tab = this.createTab(browser);
      tab.inUse = true;
      return tab;
    }
    return null;
  }
  
  releaseTab(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) tab.inUse = false;
  }
  
  closeTab(tabId) {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx !== -1) { this.tabs[idx].browser?.close(); this.tabs.splice(idx, 1); }
  }
  
  destroy() {
    for (const tab of this.tabs) { tab.browser?.close(); }
    this.tabs = [];
  }
  
  touchTab(tabId, url, title) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) { tab.lastActivity = Date.now(); if (url) tab.url = url; if (title) tab.title = title; }
  }
}

export { BrowserPool, BrowserPoolRegistry };
