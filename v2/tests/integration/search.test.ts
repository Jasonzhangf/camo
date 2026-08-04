// Search Integration Tests
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { XHSSearch } from '../../services/search/platforms/XHSSearch.js';

describe('XHS Search Integration', () => {
  let search: XHSSearch;
  
  beforeAll(async () => {
    search = new XHSSearch({ headless: true, profile: 'mobile_safari' as any });
    await search.createBrowser();
  });
  
  afterAll(async () => {
    await search.cleanup();
  });
  
  it('should navigate to search page', async () => {
    const response = await search.search('测试', { maxResults: 5 });
    // 注意：由于没有真实 Cookie，可能失败，但不应该崩溃
    expect(response).toHaveProperty('success');
    expect(response).toHaveProperty('results');
    expect(response).toHaveProperty('pageURL');
  });
  
  it('should parse results structure', async () => {
    const response = await search.search('测试', { maxResults: 10 });
    expect(Array.isArray(response.results)).toBe(true);
    for (const r of response.results) {
      expect(r).toHaveProperty('title');
      expect(r).toHaveProperty('url');
      expect(r).toHaveProperty('platform', 'xhs');
    }
  });
});
