// Search Engine - 平台无关的搜索接口

import { BrowserPoolRegistry } from '../../resources/browser/BrowserPool.mjs';
import { CookieStore, getCookieStore } from '../../core/browser/CookieStore.mjs';

export class SearchPlatform {
  constructor(config = { profile: 'mobile_safari' }) {
    this.config = config;
    this.browser = null;
    this._page = null;
  }
  
  get name() { return 'base'; }
  get searchURL() { return ''; }
  
  async createBrowser() {
    const { BrowserInstance } = await import('../../resources/browser/BrowserInstance.mjs');
    this.browser = new BrowserInstance(this.config);
    await this.browser.launch();
    return this.browser;
  }
  
  async search(query, options) {
    throw new Error('Not implemented');
  }
  
  async parseResults() { return []; }
  
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
  
  async injectCookies(netscapeText) {
    if (!this.browser) return;
    const cookieStore = getCookieStore();
    const imported = cookieStore.importNetscape(netscapeText);
    console.log(`[SearchEngine] Imported ${imported} cookies`);
    const domains = cookieStore.getBackupDomains();
    for (const domain of domains) {
      const cookies = cookieStore.loadCookies(domain);
      if (cookies.length > 0) {
        await this.browser.setCookies(cookies);
      }
    }
  }
}

export class SearchEngine {
  constructor() {
    this.platforms = new Map();
  }
  
  registerPlatform(name, platform) {
    this.platforms.set(name, platform);
  }
  
  getPlatform(name) {
    return this.platforms.get(name);
  }
  
  async search(options) {
    const Platform = this.platforms.get(options.platform);
    if (!Platform) {
      return { success: false, results: [], totalCount: 0, pageURL: '', error: `Unknown platform: ${options.platform}` };
    }
    
    const platform = new Platform({ profile: options.profile || 'default' });
    
    try {
      await platform.createBrowser();
      if (options.cookies) {
        await platform.injectCookies(options.cookies);
      }
      return await platform.search(options.query, options);
    } catch (err) {
      return { success: false, results: [], totalCount: 0, pageURL: '', error: String(err) };
    } finally {
      await platform.cleanup();
    }
  }
  
  listPlatforms() {
    return Array.from(this.platforms.keys());
  }
}

let globalSearchEngine = null;

export function getSearchEngine() {
  if (!globalSearchEngine) { globalSearchEngine = new SearchEngine(); }
  return globalSearchEngine;
}
