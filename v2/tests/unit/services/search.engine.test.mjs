// SearchEngine route unit tests.
// 不启动真实浏览器：用 mock 平台验证 register/search/listPlatforms 路由逻辑。

import test from 'node:test';
import assert from 'node:assert/strict';
import { SearchEngine } from '../../../services/search/SearchEngine.mjs';
import { parseLikeCount } from '../../../services/search/platforms/XHSSearch.mjs';
import { WeiboSearch, parseCount } from '../../../services/search/platforms/WeiboSearch.mjs';

// mock 平台：记录构造参数与调用，不启动真实浏览器
class MockPlatform {
  constructor(config) {
    this.config = config;
  }
  async createBrowser() { this.created = true; return { mock: true }; }
  async cleanup() { this.cleaned = true; }
  async injectCookies(text) { this.cookies = text; }
  async search(query, options) {
    this.lastQuery = query;
    this.lastOptions = options;
    return { success: true, results: [{ title: 't', url: 'u', platform: 'mock' }], totalCount: 1, pageURL: 'p' };
  }
}

test('registerPlatform + listPlatforms roundtrip', () => {
  const engine = new SearchEngine();
  engine.registerPlatform('mock', MockPlatform);
  assert.deepEqual(engine.listPlatforms(), ['mock']);
  assert.equal(engine.getPlatform('mock'), MockPlatform);
  assert.equal(engine.getPlatform('unknown'), undefined);
});

test('search routes to registered platform with profile config', async () => {
  const engine = new SearchEngine();
  engine.registerPlatform('mock', MockPlatform);
  const res = await engine.search({ platform: 'mock', query: '咖啡', profile: 'p1' });
  assert.equal(res.success, true);
  assert.equal(res.results.length, 1);
  assert.equal(res.results[0].title, 't');
});

test('search forwards headless option into platform config', async () => {
  const engine = new SearchEngine();
  let capturedConfig;
  class CapturePlatform extends MockPlatform {
    constructor(config) { super(config); capturedConfig = config; }
  }
  engine.registerPlatform('cap', CapturePlatform);
  await engine.search({ platform: 'cap', query: 'x', headless: true });
  assert.equal(capturedConfig.headless, true);
  assert.equal(capturedConfig.profile, 'default');
});

test('search unknown platform returns structured failure', async () => {
  const engine = new SearchEngine();
  const res = await engine.search({ platform: 'nope', query: 'x' });
  assert.equal(res.success, false);
  assert.equal(res.results.length, 0);
  assert.ok(res.error.includes('Unknown platform'));
});

test('search propagates platform error into structured failure', async () => {
  const engine = new SearchEngine();
  class FailingPlatform extends MockPlatform {
    async search() { throw new Error('boom'); }
  }
  engine.registerPlatform('fail', FailingPlatform);
  const res = await engine.search({ platform: 'fail', query: 'x' });
  assert.equal(res.success, false);
  assert.ok(res.error.includes('boom'));
});

test('parseLikeCount: plain digits', () => {
  assert.equal(parseLikeCount('295'), 295);
  assert.equal(parseLikeCount('0'), 0);
});

test('parseLikeCount: wan unit multiplies by 10000', () => {
  assert.equal(parseLikeCount('1.2万'), 12000);
  assert.equal(parseLikeCount('2万'), 20000);
});

test('parseLikeCount: yi unit multiplies by 1e8', () => {
  assert.equal(parseLikeCount('1.5亿'), 150000000);
});

test('parseLikeCount: non-numeric returns undefined', () => {
  assert.equal(parseLikeCount(''), undefined);
  assert.equal(parseLikeCount('abc'), undefined);
  assert.equal(parseLikeCount(undefined), undefined);
});

test('weibo platform registered + parseCount converts units', () => {
  const engine = new SearchEngine();
  engine.registerPlatform('weibo', WeiboSearch);
  assert.ok(engine.listPlatforms().includes('weibo'));
  assert.equal(parseCount('295'), 295);
  assert.equal(parseCount('1.2万'), 12000);
  assert.equal(parseCount('1.5亿'), 150000000);
  assert.equal(parseCount(undefined), undefined);
});
