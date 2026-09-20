// camo v2 unit tests: multi-open builtin + multiOpen operation.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __enableTestRoot as enableBridge,
  __setBrowserForTest,
  __resetForTest as resetBridge,
} from '../../../services/browser_service/internal/camoufox_bridge.mjs';

describe('builtins.multi-open', () => {
  test('registry lists multi-open', async () => {
    const { list } = await import('../../../commands/registry/registry.mjs');
    assert.equal(list().includes('multi-open'), true);
  });

  test('builtin index exposes multi-open', async () => {
    const { isBuiltin } = await import('../../../commands/builtins/index.mjs');
    assert.equal(isBuiltin('multi-open'), true);
  });

  test('run rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/multiOpen.mjs');
    await assert.rejects(run(null, {}), (e) => e.code === 'E_INPUT_INVALID');
  });

  test('run rejects missing urls', async () => {
    const { run } = await import('../../../commands/builtins/multiOpen.mjs');
    const fake = { async sendFrame() { return { ok: true }; } };
    await assert.rejects(run(fake, { named: {}, profile: 'default' }), (e) => e.code === 'E_INPUT_MISSING_FIELD');
  });

  test('run sends multi-open command with parsed urls', async () => {
    const { run } = await import('../../../commands/builtins/multiOpen.mjs');
    let sent = null;
    const fake = {
      async sendFrame(env) {
        sent = env;
        return {
          id: env.id,
          kind: 'result',
          payload: { opened: [{ tabId: 0, url: 'https://a.com' }], screenshots: [], errors: [] },
        };
      },
    };
    const out = await run(fake, { named: { urls: 'https://a.com, https://b.com', outDir: '/tmp/x', prefix: 'shot' }, profile: 'default' });
    assert.equal(sent.payload.cmd, 'multi-open');
    assert.deepEqual(sent.payload.args.urls, ['https://a.com', 'https://b.com']);
    assert.equal(sent.payload.args.outDir, '/tmp/x');
    assert.equal(sent.payload.args.prefix, 'shot');
    assert.equal(out.opened.length, 1);
  });
});

describe('page_runtime.multiOpen-operation', () => {
  const activeTarget = (page) => ({ targetId: 't_multi', profileId: 'default', pageId: 'page_multi', status: 'active', page });

  test('multiOpen registered in input pipeline', async () => {
    const pipeline = await import('../../../services/page_runtime/input_pipeline.mjs');
    assert.equal(typeof pipeline.multiOpen, 'function');
  });

  test('multiOpen rejects empty url list', async () => {
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');
    await assert.rejects(multiOpen({ profileId: 'default', target: activeTarget({}), urls: [] }), (e) => e.code === 'E_INPUT_MISSING_FIELD');
    await assert.rejects(multiOpen({ profileId: 'default', target: activeTarget({}), urls: ['not-a-url'] }), (e) => e.code === 'E_INPUT_INVALID');
  });

  test('multiOpen rejects invalid urls without truncating the request', async () => {
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');
    await assert.rejects(multiOpen({ profileId: 'default', target: activeTarget({}), urls: ['ftp://x', 'gopher://y'] }), (e) => e.code === 'E_INPUT_INVALID');
    await assert.rejects(
      multiOpen({ profileId: 'default', target: activeTarget({}), urls: ['https://example.com', 'ftp://x'] }),
      (e) => e.code === 'E_INPUT_INVALID',
    );
  });

  test('multiOpen without a target handle throws E_STATE_INVALID', async () => {
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');
    await assert.rejects(multiOpen({ profileId: 'no-such-profile', urls: ['https://a.com'] }), (e) => e.code === 'E_STATE_INVALID');
  });

  test('positive: successful pages remain open and return internal page handles', async () => {
    enableBridge();
    const pages = [];
    const makePage = (url) => ({
      async goto() {},
      url: () => url,
      async screenshot() { return Buffer.from('png'); },
      async close() { throw new Error('successful page must remain caller-owned'); },
    });
    const context = {
      pages: () => pages,
      async newPage() {
        const page = makePage(`https://example.com/${pages.length + 1}`);
        pages.push(page);
        return page;
      },
    };
    __setBrowserForTest('multi-open-success', { context, page: null });
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');

    const result = await multiOpen({
      profileId: 'multi-open-success',
      target: activeTarget({}),
      urls: ['https://example.com/a', 'https://example.com/b'],
    });

    assert.equal(result.opened.length, 2);
    assert.equal(result.opened[0].page, pages[0]);
    assert.equal(result.opened[1].page, pages[1]);
    assert.equal(result.screenshots.length, 2);
    assert.equal(pages.length, 2);
    resetBridge();
  });

  test('negative: navigation failure closes every tab created by multi-open', async () => {
    enableBridge();
    const pages = [];
    const closed = [];
    const context = {
      pages: () => pages,
      async newPage() {
        const index = pages.length;
        const page = {
          async goto() {
            if (index === 1) throw new Error('navigation failed');
          },
          url: () => `https://example.com/${index}`,
          async screenshot() { return Buffer.from('png'); },
          async close() { closed.push(index); },
        };
        pages.push(page);
        return page;
      },
    };
    __setBrowserForTest('multi-open-failure', { context, page: null });
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');

    await assert.rejects(
      multiOpen({
        profileId: 'multi-open-failure',
        target: activeTarget({}),
        urls: ['https://example.com/a', 'https://example.com/b'],
      }),
      (cause) => cause?.code === 'E_BROWSER_MULTIOPEN_FAILED',
    );
    assert.deepEqual(closed, [1, 0]);
    resetBridge();
  });

  test('positive: listTabs projects resolved targets and page ids', async () => {
    enableBridge();
    const first = { url: () => 'https://example.com/', title: async () => 'Example' };
    const second = { url: () => 'https://news.ycombinator.com/', title: async () => 'Hacker News' };
    __setBrowserForTest('list-tabs-placeholders', {
      context: { pages: () => [first, second] },
      page: first,
    });
    const { listTabs } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');

    const result = await listTabs({
      profileId: 'list-tabs-placeholders',
      targets: [
        { targetId: 't_one', pageId: 'page_one', status: 'active', page: first },
        { targetId: 't_two', pageId: 'page_two', status: 'active', page: second },
      ],
    });

    assert.equal(result.count, 2);
    assert.deepEqual(result.tabs, [
      { target: 't_one', page: 'page_one', url: 'https://example.com/', title: 'Example' },
      { target: 't_two', page: 'page_two', url: 'https://news.ycombinator.com/', title: 'Hacker News' },
    ]);
    resetBridge();
  });

  test('positive: newTab returns the created page handle', async () => {
    enableBridge();
    const page = {
      url: () => 'https://example.com/new',
      async goto() {},
      async close() {},
    };
    __setBrowserForTest('new-tab-visible-index', {
      context: {
        pages: () => [page],
        async newPage() {
          return page;
        },
      },
    });
    const { newTab } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');

    const result = await newTab({
      profileId: 'new-tab-visible-index',
      target: activeTarget({}),
      url: 'https://example.com/new',
    });

    assert.equal(result.page, page);
    resetBridge();
  });

  test('positive: multiOpen returns page handles in opened and screenshot projections', async () => {
    enableBridge();
    const pages = [];
    const context = {
      pages: () => pages,
      async newPage() {
        const page = {
          url: () => `https://example.com/${pages.length + 1}`,
          async goto() {},
          async screenshot() { return Buffer.from('png'); },
          async close() {},
        };
        pages.push(page);
        return page;
      },
    };
    __setBrowserForTest('multi-open-visible-index', { context, page: null });
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');

    const result = await multiOpen({
      profileId: 'multi-open-visible-index',
      target: activeTarget({}),
      urls: ['https://example.com/a', 'https://example.com/b'],
    });

    assert.deepEqual(result.opened.map((entry) => entry.page), pages);
    assert.deepEqual(result.screenshots.map((entry) => entry.page), pages);
    resetBridge();
  });
});
