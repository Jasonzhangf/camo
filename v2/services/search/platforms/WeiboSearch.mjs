// Weibo 搜索平台 - 带登录检查

import { SearchPlatform } from '../SearchEngine.mjs';
import { BrowserInstance } from '../../../resources/browser/BrowserInstance.mjs';

// 解析微博计数：支持 "295" / "1.2万" / "1.5亿" 中文单位。
// 与 XHSSearch.parseLikeCount 相同的唯一换算逻辑，注入页面脚本内联同一源码。
export function parseCount(raw) {
  if (!raw) return undefined;
  const s = String(raw).trim();
  const m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(万|亿)?$/);
  if (!m) return undefined;
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return undefined;
  if (m[2] === '万') return Math.round(num * 10000);
  if (m[2] === '亿') return Math.round(num * 100000000);
  return Math.round(num);
}

export class WeiboSearch extends SearchPlatform {
  constructor(config) {
    super(config);
    this.domain = 'weibo.com';
  }
  get name() { return 'weibo'; }
  get searchURL() { return 'https://s.weibo.com/weibo'; }

  async createBrowser() {
    const h = this.config.headless;
    const headless = h === true || h === 'true';
    this.browser = new BrowserInstance({
      headless,
      profile: this.config.profile || 'default',
    });
    await this.browser.launch();
    return this.browser;
  }

  // 确保已登录（登录态由持久化 profile 自动管理）
  async ensureLoggedIn() {
    if (!this.browser) await this.createBrowser();
    // 微博登录态 cookie 与小红书不同：SUB/SUBP/WBPSESS 系列。
    // 先看登录墙文案判断是否在登录页，再看登录态 cookie 二次确认。
    const loginCookieNames = ['SUB', 'SUBP', 'WBPSESS'];
    const loginPageHosts = ['passport.weibo.com', 'weibo.com/newlogin'];
    const isLoggedIn = await this.browser.hasSessionCookies('https://weibo.com', loginCookieNames);
    if (isLoggedIn === false) {
      console.log('[WeiboSearch] Not logged in, launching login flow...');
      if (this.browser.config.headless) {
        await this.browser.close();
        this.browser = new BrowserInstance({ headless: false, profile: this.config.profile || 'default' });
        await this.browser.launch();
      }
      // 标准流程：停在登录页等待用户扫码，登录态 cookie 出现即继续
      const loggedIn = await this.browser.launchWithLogin(this.domain, 'https://weibo.com/login.php', { loginCookieNames, loginPageHosts });
      if (!loggedIn) {
        throw new Error('NOT_LOGGED_IN: Login failed or cancelled');
      }
    }
    return true;
  }

  async search(query, options = {}) {
    const maxResults = options.maxResults || 20;
    const timeout = options.timeout || 60000;
    const loginCookieNames = ['SUB', 'SUBP', 'WBPSESS'];
    const loginPageHosts = ['passport.weibo.com', 'weibo.com/newlogin'];

    try {
      await this.ensureLoggedIn();
      const searchUrl = `https://s.weibo.com/weibo?q=${encodeURIComponent(query)}`;
      console.log('[WeiboSearch] Navigating to:', searchUrl);

      await this.browser.navigate(searchUrl, timeout);
      await this.browser.waitForDomStable(10000);

      // 标准流程：若搜索页被重定向到登录页（未登录），停在登录页等待用户扫码，
      // 登录态 cookie 出现后继续搜索。
      const redirected = await this.browser.executeJS(`(function() {
        const u = window.location.href || '';
        const body = document.body ? document.body.innerText : '';
        return u.indexOf('passport.weibo.com') !== -1 || /扫码登录|账号登录|获取验证码/.test(body);
      })()`);
      if (redirected) {
        console.log('[WeiboSearch] Search redirected to login, waiting for scan-login...');
        const loggedIn = await this.browser.launchWithLogin(this.domain, 'https://weibo.com/login.php', { loginCookieNames, loginPageHosts });
        if (!loggedIn) {
          throw new Error('NOT_LOGGED_IN: Login failed or cancelled');
        }
        await this.browser.navigate(searchUrl, timeout);
        await this.browser.waitForDomStable(10000);
      }

      for (let i = 0; i < 3; i++) {
        await this.browser.scroll('down', 800);
        await this.browser.waitForDomStable(3000);
      }

      const results = await this.parseResultsFromPage(maxResults);
      console.log(`[WeiboSearch] Found ${results.length} results`);
      return { success: true, results, totalCount: results.length, pageURL: this.browser.currentPageURL };
    } catch (err) {
      console.error('[WeiboSearch] Error:', err.message);
      return { success: false, results: [], totalCount: 0, pageURL: this.browser?.currentPageURL || '', error: String(err) };
    }
  }

  async parseResultsFromPage(maxResults) {
    const script = `(function() {
      ${parseCount.toString()}
      const notes = [];
      const selectors = [
        '.card-wrap[action-type="feed_list_item"]',
        '.card-wrap',
        '[action-type="feed_list_item"]',
        '.card',
      ];

      let elements = [];
      for (const sel of selectors) {
        elements = Array.from(document.querySelectorAll(sel));
        if (elements.length > 0) break;
      }

      elements.slice(0, ${maxResults}).forEach(el => {
        const titleEl = el.querySelector('.content .txt, .txt, [class*="content"] [class*="txt"]');
        const title = titleEl ? titleEl.textContent.trim() : '';

        const linkEl = el.querySelector('a[href*="/weibo/"]') || el.closest('a');
        let url = linkEl ? linkEl.href : '';
        if (url && !url.startsWith('http')) url = 'https://weibo.com' + url;

        const authorEl = el.querySelector('.name, .nickname, [class*="name"]');
        const author = authorEl ? authorEl.textContent.trim() : '';

        const repostEl = el.querySelector('.card-act .act.forward, [action-type="fl_forward"] .num, [class*="forward"] .num');
        const repostsRaw = repostEl ? repostEl.textContent.trim() : '';
        const reposts = parseCount(repostsRaw);

        const commentEl = el.querySelector('.card-act .act.comment, [action-type="fl_comment"] .num, [class*="comment"] .num');
        const commentsRaw = commentEl ? commentEl.textContent.trim() : '';
        const comments = parseCount(commentsRaw);

        const likeEl = el.querySelector('.card-act .act.like, [action-type="fl_like"] .num, [class*="like"] .num');
        const likesRaw = likeEl ? likeEl.textContent.trim() : '';
        const likes = parseCount(likesRaw);

        if (title || url) notes.push({ title, url, author, reposts, comments, likes });
      });

      return notes;
    })()`;

    const result = await this.browser.executeJS(script);

    if (result && result.length > 0) {
      return result.map(r => ({
        title: r.title || '',
        url: r.url || '',
        author: r.author || '',
        reposts: typeof r.reposts === 'number' ? r.reposts : undefined,
        comments: typeof r.comments === 'number' ? r.comments : undefined,
        likes: typeof r.likes === 'number' ? r.likes : undefined,
        platform: 'weibo',
      }));
    }
    return [];
  }
}
