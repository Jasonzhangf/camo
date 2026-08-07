// BrowserInstance cookie save/load unit tests.
// 不启动真实浏览器：直接测 domain 规范化与按 domain 过滤保存逻辑。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 动态加载 BrowserInstance 并隔离模块内 COOKIE_DIR
const COOKIE_TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-bi-cookie-'));
const prevHome = process.env.HOME;
process.env.HOME = COOKIE_TEST_DIR;

const { BrowserInstance } = await import('../../../resources/browser/BrowserInstance.mjs');

test.after(() => {
  process.env.HOME = prevHome;
  fs.rmSync(COOKIE_TEST_DIR, { recursive: true, force: true });
});

test('normalizeDomain strips leading dot', () => {
  const bi = new BrowserInstance({ profile: 'test-p1' });
  assert.equal(bi._normalizeDomain('.xiaohongshu.com'), 'xiaohongshu.com');
  assert.equal(bi._normalizeDomain('xiaohongshu.com'), 'xiaohongshu.com');
  assert.equal(bi._normalizeDomain(''), '');
  bi.close();
});

test('cookieMatchesDomain: subdomain and leading-dot variants match', () => {
  const bi = new BrowserInstance({ profile: 'test-p2' });
  assert.equal(bi._cookieMatchesDomain('.xiaohongshu.com', 'xiaohongshu.com'), true);
  assert.equal(bi._cookieMatchesDomain('www.xiaohongshu.com', 'xiaohongshu.com'), true);
  assert.equal(bi._cookieMatchesDomain('edith.xiaohongshu.com', 'xiaohongshu.com'), true);
  assert.equal(bi._cookieMatchesDomain('xiaohongshu.com', 'xiaohongshu.com'), true);
  assert.equal(bi._cookieMatchesDomain('example.org', 'xiaohongshu.com'), false);
  assert.equal(bi._cookieMatchesDomain('', 'xiaohongshu.com'), false);
  bi.close();
});

test('getCookiePath normalizes domain in file name', () => {
  const bi = new BrowserInstance({ profile: 'test-p3' });
  const p1 = bi.getCookiePath('.xiaohongshu.com');
  const p2 = bi.getCookiePath('xiaohongshu.com');
  assert.equal(p1, p2, 'leading-dot and bare domain must map to same file');
  assert.ok(p1.endsWith('xiaohongshu.com.json'), `expected xiaohongshu.com.json, got ${p1}`);
  assert.ok(p1.includes(path.join('test-p3', 'xiaohongshu.com.json')), 'profile dir used');
  bi.close();
});

test('saveCookies filters cookies to matching domain before writing', async () => {
  const bi = new BrowserInstance({ profile: 'test-p4' });
  // 伪造 _browser.contexts()[0].cookies() 返回混合域 cookies
  const allCookies = [
    { name: 'xhs1', value: 'a', domain: '.xiaohongshu.com', path: '/' },
    { name: 'xhs2', value: 'b', domain: 'www.xiaohongshu.com', path: '/' },
    { name: 'other', value: 'c', domain: '.example.org', path: '/' },
  ];
  bi._browser = {
    contexts: () => [{ cookies: async () => allCookies }],
  };
  await bi.saveCookies('xiaohongshu.com');
  const file = bi.getCookiePath('xiaohongshu.com');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.length, 2, 'only xiaohongshu cookies saved');
  assert.ok(saved.every(c => c.domain.includes('xiaohongshu')), 'no cross-domain cookies in file');
  bi._browser = null;
  bi.close();
});

test('saveCookies with no matching cookies writes nothing', async () => {
  const bi = new BrowserInstance({ profile: 'test-p5' });
  const allCookies = [
    { name: 'other', value: 'c', domain: '.example.org', path: '/' },
  ];
  bi._browser = {
    contexts: () => [{ cookies: async () => allCookies }],
  };
  const file = bi.getCookiePath('xiaohongshu.com');
  fs.rmSync(file, { force: true });
  await bi.saveCookies('xiaohongshu.com');
  assert.equal(fs.existsSync(file), false, 'no file written when no matching cookies');
  bi._browser = null;
  bi.close();
});

test('loadCookies reads normalized domain file (no leading dot)', async () => {
  const bi = new BrowserInstance({ profile: 'test-p6' });
  // 预写 xiaohongshu.com.json（规范化文件名）
  const file = bi.getCookiePath('xiaohongshu.com');
  fs.writeFileSync(file, JSON.stringify([
    { name: 'xhs1', value: 'a', domain: '.xiaohongshu.com', path: '/', expires: 1786026438 },
  ]));
  let addCookiesArg = null;
  bi._browser = {
    contexts: () => [{ addCookies: async (c) => { addCookiesArg = c; } }],
  };
  // 用带前导点的 domain 调用，应命中同一文件
  const ok = await bi.loadCookies('.xiaohongshu.com');
  assert.equal(ok, true);
  assert.ok(addCookiesArg, 'addCookies called');
  assert.equal(addCookiesArg.length, 1);
  assert.equal(addCookiesArg[0].name, 'xhs1');
  assert.equal(addCookiesArg[0].domain, 'xiaohongshu.com', 'leading dot stripped before addCookies');
  bi._browser = null;
  bi.close();
});

test('loadCookies skips cookies with missing domain', async () => {
  const bi = new BrowserInstance({ profile: 'test-p8' });
  const file = bi.getCookiePath('xiaohongshu.com');
  fs.writeFileSync(file, JSON.stringify([
    { name: 'good', value: 'a', domain: '.xiaohongshu.com', path: '/', expires: 1786026438 },
    { name: 'no-domain', value: 'b', path: '/' },
  ]));
  let addCookiesArg = null;
  bi._browser = {
    contexts: () => [{ addCookies: async (c) => { addCookiesArg = c; } }],
  };
  const ok = await bi.loadCookies('xiaohongshu.com');
  assert.equal(ok, true);
  assert.equal(addCookiesArg.length, 1, 'cookie without domain filtered out');
  assert.equal(addCookiesArg[0].name, 'good');
  bi._browser = null;
  bi.close();
});

test('close on never-launched instance still marks closed', async () => {
  const bi = new BrowserInstance({ profile: 'test-p9' });
  assert.equal(bi.closed, false);
  await bi.close();
  assert.equal(bi.closed, true, 'close() must set closed even without launch');
});

test('loadCookies falls back to .txt Netscape format', async () => {
  const bi = new BrowserInstance({ profile: 'test-p7' });
  const dir = bi.getCookieDir();
  fs.writeFileSync(path.join(dir, 'xiaohongshu.com.txt'),
    '# Netscape HTTP Cookie File\n' +
    '.xiaohongshu.com\tTRUE\t/\tFALSE\t1786026438\txhs1\ta\n'
  );
  let addCookiesArg = null;
  bi._browser = {
    contexts: () => [{ addCookies: async (c) => { addCookiesArg = c; } }],
  };
  const ok = await bi.loadCookies('xiaohongshu.com');
  assert.equal(ok, true);
  assert.equal(addCookiesArg.length, 1);
  assert.equal(addCookiesArg[0].name, 'xhs1');
  bi._browser = null;
  bi.close();
});

// ---- 登录检测（launchWithLogin 轮询判定复用同一锚点）----

test('hasLoginPrompt detects login-wall anchors', () => {
  assert.equal(BrowserInstance.hasLoginPrompt('手机号登录'), true);
  assert.equal(BrowserInstance.hasLoginPrompt('获取验证码'), true);
  assert.equal(BrowserInstance.hasLoginPrompt('扫码登录'), true);
  assert.equal(BrowserInstance.hasLoginPrompt('登录后推荐更懂你的笔记'), true);
  assert.equal(BrowserInstance.hasLoginPrompt('创作中心 我的 消息 首页 发现'), false, 'logged-in nav must not trigger');
  assert.equal(BrowserInstance.hasLoginPrompt(''), false);
});

test('_saveAllCookies groups by normalized domain and writes files', async () => {
  const bi = new BrowserInstance({ profile: 'test-p10' });
  const allCookies = [
    { name: 'x1', value: 'a', domain: '.xiaohongshu.com', path: '/' },
    { name: 'x2', value: 'b', domain: 'www.xiaohongshu.com', path: '/' },
    { name: 'o1', value: 'c', domain: '.example.org', path: '/' },
    { name: 'nod', value: 'd', path: '/' }, // 无 domain：跳过
  ];
  bi._browser = { contexts: () => [{ cookies: async () => allCookies }] };
  await bi._saveAllCookies();
  const xhs = JSON.parse(fs.readFileSync(bi.getCookiePath('xiaohongshu.com'), 'utf8'));
  const org = JSON.parse(fs.readFileSync(bi.getCookiePath('example.org'), 'utf8'));
  assert.equal(xhs.length, 2, 'xiaohongshu cookies grouped (leading dot + www)');
  assert.equal(org.length, 1);
  assert.equal(fs.existsSync(bi.getCookiePath('nod')), false, 'domain-less cookie skipped');
  // stopAutoSave 无副作用（未启动定时器时）
  bi.stopAutoSave();
  bi._browser = null;
  bi.close();
});

test('autoSave timer stops on close and unrefs', async () => {
  const bi = new BrowserInstance({ profile: 'test-p11' });
  let calls = 0;
  bi._browser = { contexts: () => [{ cookies: async () => [] }] };
  bi._saveAllCookies = async () => { calls++; };
  bi.startAutoSave(30);
  assert.ok(bi._autoSaveTimer, 'timer started');
  await new Promise(r => setTimeout(r, 80));
  assert.ok(calls > 0, 'periodic save invoked');
  await bi.close();
  assert.equal(bi._autoSaveTimer, null, 'timer cleared on close');
  const before = calls;
  await new Promise(r => setTimeout(r, 70));
  assert.equal(calls, before, 'no saves after close');
});
test('_detectLoginOnCurrentPage: login-wall page -> false, logged-in page -> true', async () => {
  const bi = new BrowserInstance({ profile: 'test-p9' });
  // 未登录：登录墙文案
  bi.page = { evaluate: async () => '登录后推荐更懂你的笔记\n手机号登录\n获取验证码\n登录' };
  bi._browser = { contexts: () => [{ cookies: async () => [] }] };
  assert.equal(await bi._detectLoginOnCurrentPage(), false);
  // 无登录墙但无登录态 cookie（匿名页，如风控/跳转页）：不能算登录
  bi.page = { evaluate: async () => '首页 发现 创作中心 我的 消息 推荐笔记内容...' };
  bi._browser = { contexts: () => [{ cookies: async () => [{ name: 'webId', value: 'x' }] }] };
  assert.equal(await bi._detectLoginOnCurrentPage(), false, 'anonymous cookies must not count as logged in');
  // 已登录：无登录墙 + 登录态 cookie web_session
  bi._browser = { contexts: () => [{ cookies: async () => [{ name: 'web_session', value: 'abc' }] }] };
  assert.equal(await bi._detectLoginOnCurrentPage(), true);
  // web_session_available 同样视为登录态
  bi._browser = { contexts: () => [{ cookies: async () => [{ name: 'web_session_available', value: '1' }] }] };
  assert.equal(await bi._detectLoginOnCurrentPage(), true);
  // 页面为空（加载失败/跳转中）：安全判 false
  bi.page = { evaluate: async () => '' };
  assert.equal(await bi._detectLoginOnCurrentPage(), false);
  // evaluate 抛错（导航中断）：安全判 false
  bi.page = { evaluate: async () => { throw new Error('nav interrupted'); } };
  assert.equal(await bi._detectLoginOnCurrentPage(), false);
  // 实例已关闭：false
  bi.close();
  bi.page = { evaluate: async () => 'x' };
  assert.equal(await bi._detectLoginOnCurrentPage(), false);
});
