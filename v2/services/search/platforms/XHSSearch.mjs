// XHS 搜索平台

import { SearchPlatform } from '../SearchEngine.mjs';

export class XHSSearch extends SearchPlatform {
  constructor(config) { super(config); }
  get name() { return 'xhs'; }
  get searchURL() { return 'https://edith.xiaohongshu.com/search_result'; }
  
  async search(query, options = {}) {
    const maxResults = options.maxResults || 20;
    const timeout = options.timeout || 60000;
    
    try {
      const searchUrl = `https://edith.xiaohongshu.com/search_result?keyword=${encodeURIComponent(query)}&source=web_search_result_notes`;
      await this.browser.navigate(searchUrl, timeout);
      await this.browser.waitForDomStable(10000);
      
      for (let i = 0; i < 3; i++) {
        await this.browser.scroll('down', 800);
        await this.browser.waitForDomStable(5000);
      }
      
      const results = await this.parseResultsFromPage(maxResults);
      return { success: true, results, totalCount: results.length, pageURL: this.browser.currentPageURL };
    } catch (err) {
      return { success: false, results: [], totalCount: 0, pageURL: this.browser?.currentPageURL || '', error: String(err) };
    }
  }
  
  async parseResultsFromPage(maxResults) {
    const script = `
      () => {
        const notes = [];
        const selectors = ['.search-result-container .note-item', '[class*="search"] [class*="note"]', '.feeds-page .note-card'];
        let elements = [];
        for (const sel of selectors) {
          elements = Array.from(document.querySelectorAll(sel));
          if (elements.length > 0) break;
        }
        elements.slice(0, ${maxResults}).forEach(el => {
          const title = el.querySelector('.title, [class*="title"]')?.textContent?.trim() || '';
          const author = el.querySelector('.author, [class*="user"]')?.textContent?.trim() || '';
          const likes = el.querySelector('[class*="like"], [class*="heart"]')?.textContent?.trim() || '';
          const link = el.querySelector('a[href*="/discovery"]')?.href || '';
          if (title || link) notes.push({ title, url: link, author, likes });
        });
        return notes;
      }
    `;
    
    try {
      const rawResults = await this.browser.executeJS(script) || [];
      return rawResults.map(r => ({
        title: r.title || '',
        url: r.url || '',
        author: r.author || '',
        likes: r.likes ? parseInt(String(r.likes).replace(/[^0-9]/g, ''), 10) : undefined,
        platform: 'xhs',
      }));
    } catch { return []; }
  }
}
