// XHS 搜索平台 - 带登录检查

import { SearchPlatform } from '../SearchEngine.mjs';
import { BrowserInstance } from '../../../resources/browser/BrowserInstance.mjs';

export class XHSSearch extends SearchPlatform {
  constructor(config) { 
    super(config); 
    this.domain = 'xiaohongshu';
  }
  get name() { return 'xhs'; }
  
  async createBrowser() {
    // 社交媒体搜索默认使用有头模式以便登录
    const headless = this.config.headless !== undefined ? this.config.headless : false;
    this.browser = new BrowserInstance({ 
      headless,
      profile: this.config.profile || 'default' 
    });
    await this.browser.launch();
    return this.browser;
  }
  
  // 确保已登录
  async ensureLoggedIn() {
    if (!this.browser) await this.createBrowser();
    
    // 先尝试加载已有 Cookie
    const hasCookies = await this.browser.loadCookies(this.domain);
    
    // 检查登录状态
    const isLoggedIn = await this.browser.checkLoginStatus();
    
    if (!isLoggedIn) {
      console.log('[XHSSearch] Not logged in, launching login flow...');
      // 需要登录，使用有头模式
      if (this.browser.config.headless) {
        // 如果当前是无头模式，重新启动有头模式
        await this.browser.close();
        this.browser = new BrowserInstance({ headless: false, profile: this.config.profile || 'default' });
        await this.browser.launch();
        await this.browser.loadCookies(this.domain);
      }
      
      // 启动登录流程
      const loggedIn = await this.browser.launchWithLogin(this.domain, 'https://www.xiaohongshu.com');
      if (!loggedIn) {
        throw new Error('NOT_LOGGED_IN: Login failed or cancelled');
      }
    }
    
    return true;
  }
  
  async search(query, options = {}) {
    const maxResults = options.maxResults || 20;
    const timeout = options.timeout || 60000;
    
    try {
      // 1. 确保已登录
      await this.ensureLoggedIn();
      
      // 2. 导航到搜索页面
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_explore_feed`;
      console.log('[XHSSearch] Navigating to:', searchUrl);
      
      await this.browser.navigate(searchUrl, timeout);
      await this.browser.waitForDomStable(10000);
      
      // 3. 检查搜索结果是否为空（可能是未登录导致）
      // 只有当页面完全无法加载内容时才认为需要登录
      const bodyText = await this.browser.getReadable();
      const hasLoginWall = bodyText.includes('登录后查看搜索结果') && !bodyText.includes('搜索到');
      const hasLoginPopup = bodyText.includes('扫码登录') && bodyText.length < 500;
      if (hasLoginWall || hasLoginPopup) {
        console.log('[XHSSearch] Detected login wall or popup on search results');
        // 不直接返回失败，先尝试滚动加载
      }
      
      // 4. 滚动加载更多内容
      for (let i = 0; i < 3; i++) {
        await this.browser.scroll('down', 800);
        await this.browser.waitForDomStable(3000);
      }
      
      // 5. 解析结果
      const results = await this.parseResultsFromPage(maxResults);
      console.log(`[XHSSearch] Found ${results.length} results`);
      
      return { success: true, results, totalCount: results.length, pageURL: this.browser.currentPageURL };
    } catch (err) {
      console.error('[XHSSearch] Error:', err.message);
      return { success: false, results: [], totalCount: 0, pageURL: this.browser?.currentPageURL || '', error: String(err) };
    }
  }
  
  async parseResultsFromPage(maxResults) {
    const script = `(function() {
      const notes = [];
      const selectors = [
        '[class*="discovery"] [class*="note"]',
        '.search-result .note-item',
        '[class*="feeds"] [class*="item"]',
        'section[class*="search"] [class*="item"]',
        '.feeds-container > div',
      ];
      
      let elements = [];
      for (const sel of selectors) {
        elements = Array.from(document.querySelectorAll(sel));
        if (elements.length > 0) break;
      }
      
      elements.slice(0, ${maxResults}).forEach(el => {
        const titleEl = el.querySelector('h1, h2, h3, [class*="title"], [class*="desc"]');
        const title = titleEl ? titleEl.textContent.trim() : '';
        
        const linkEl = el.querySelector('a[href*="/discovery/"]') || el.closest('a');
        let url = linkEl ? linkEl.href : '';
        if (url && !url.startsWith('http')) url = 'https://www.xiaohongshu.com' + url;
        
        const authorEl = el.querySelector('[class*="user"] [class*="name"]');
        const author = authorEl ? authorEl.textContent.trim() : '';
        
        if (title || url) notes.push({ title: title, url: url, author: author });
      });
      
      return notes;
    })()`;
    
    const result = await this.browser.executeJS(script);
    
    if (result && result.length > 0) {
      return result.map(r => ({
        title: r.title || '',
        url: r.url || '',
        author: r.author || '',
        platform: 'xhs',
      }));
    }
    return [];
  }
}
