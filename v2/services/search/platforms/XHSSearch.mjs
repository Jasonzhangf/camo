// XHS 搜索平台 - 清理版

import { SearchPlatform } from '../SearchEngine.mjs';
import { BrowserInstance } from '../../../resources/browser/BrowserInstance.mjs';

export class XHSSearch extends SearchPlatform {
  constructor(config) { 
    super(config); 
  }
  get name() { return 'xhs'; }
  
  async createBrowser() {
    this.browser = new BrowserInstance({ headless: true, profile: 'mobile_safari' });
    await this.browser.launch();
    return this.browser;
  }
  
  async search(query, options = {}) {
    const maxResults = options.maxResults || 20;
    const timeout = options.timeout || 60000;
    
    try {
      if (!this.browser) {
        await this.createBrowser();
      }
      
      const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_explore_feed`;
      
      await this.browser.navigate(searchUrl, timeout);
      await this.browser.waitForDomStable(10000);
      
      // 滚动加载
      for (let i = 0; i < 3; i++) {
        await this.browser.scroll('down', 800);
        await this.browser.waitForDomStable(3000);
      }
      
      const results = await this.parseResultsFromPage(maxResults);
      return { success: true, results, totalCount: results.length, pageURL: this.browser.currentPageURL };
    } catch (err) {
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
