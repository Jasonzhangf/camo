// Search Engine - 平台无关的搜索接口

import type { BrowserInstance, BrowserInstanceConfig } from '../../resources/browser/BrowserInstance.js';
import type { BrowserPool } from '../../resources/browser/BrowserPool.js';
import type { BrowserPoolRegistry } from '../../resources/browser/BrowserPool.js';
import { CookieStore, getCookieStore } from '../../core/browser/CookieStore.js';

export interface SearchOptions {
  platform: string;
  query: string;
  cookies?: string;
  profile?: string;
  timeout?: number;
  maxResults?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  author?: string;
  likes?: number;
  comments?: number;
  timestamp?: string;
  platform: string;
  raw?: unknown;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  totalCount: number;
  pageURL: string;
  error?: string;
}

// 搜索平台基类
export abstract class SearchPlatform {
  abstract readonly name: string;
  abstract readonly searchURL: string;
  
  protected browser?: BrowserInstance;
  protected _page?: any;
  
  constructor(public config: BrowserInstanceConfig = { profile: 'mobile_safari' as any }) {}
  
  async createBrowser(): Promise<BrowserInstance> {
    const { BrowserInstance } = await import('../../resources/browser/BrowserInstance.js');
    this.browser = new BrowserInstance(this.config);
    await this.browser.launch();
    return this.browser;
  }
  
  abstract search(query: string, options?: Partial<SearchOptions>): Promise<SearchResponse>;
  
  async parseResults(): Promise<SearchResult[]> { return []; }
  
  async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = undefined;
    }
  }
  
  async injectCookies(netscapeText: string): Promise<void> {
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

// 搜索引擎管理器
export class SearchEngine {
  private platforms: Map<string, new (config?: any) => SearchPlatform> = new Map();
  
  constructor() {}
  
  registerPlatform(name: string, platform: new (config?: any) => SearchPlatform): void {
    this.platforms.set(name, platform);
  }
  
  async search(options: SearchOptions): Promise<SearchResponse> {
    const Platform = this.platforms.get(options.platform);
    if (!Platform) {
      return { success: false, results: [], totalCount: 0, pageURL: '', error: `Unknown platform: ${options.platform}` };
    }
    
    const platform = new Platform({ profile: 'mobile_safari' as any });
    
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
  
  listPlatforms(): string[] {
    return Array.from(this.platforms.keys());
  }
}

let globalSearchEngine: SearchEngine | null = null;

export function getSearchEngine(): SearchEngine {
  if (!globalSearchEngine) { globalSearchEngine = new SearchEngine(); }
  return globalSearchEngine;
}
