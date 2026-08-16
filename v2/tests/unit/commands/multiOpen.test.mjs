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
  test('multiOpen registered in input pipeline', async () => {
    const pipeline = await import('../../../services/page_runtime/input_pipeline.mjs');
    assert.equal(typeof pipeline.multiOpen, 'function');
  });

  test('multiOpen rejects empty url list', async () => {
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');
    await assert.rejects(multiOpen({ profileId: 'default', urls: [] }), (e) => e.code === 'E_INPUT_MISSING_FIELD');
    await assert.rejects(multiOpen({ profileId: 'default', urls: ['not-a-url'] }), (e) => e.code === 'E_INPUT_INVALID');
  });

  test('multiOpen rejects invalid urls without truncating the request', async () => {
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');
    await assert.rejects(multiOpen({ profileId: 'default', urls: ['ftp://x', 'gopher://y'] }), (e) => e.code === 'E_INPUT_INVALID');
    await assert.rejects(
      multiOpen({ profileId: 'default', urls: ['https://example.com', 'ftp://x'] }),
      (e) => e.code === 'E_INPUT_INVALID',
    );
  });

  test('multiOpen without active browser throws E_STATE_NOT_FOUND', async () => {
    const { multiOpen } = await import('../../../services/page_runtime/operations/navigation_ops.mjs');
    await assert.rejects(multiOpen({ profileId: 'no-such-profile', urls: ['https://a.com'] }), (e) => e.code === 'E_STATE_NOT_FOUND');
  });

  test('positive: successful pages remain open with stable index tab ids', async () => {
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
      urls: ['https://example.com/a', 'https://example.com/b'],
    });

    assert.deepEqual(result.opened.map((entry) => entry.tabId), [0, 1]);
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
        urls: ['https://example.com/a', 'https://example.com/b'],
      }),
      (cause) => cause?.code === 'E_BROWSER_MULTIOPEN_FAILED',
    );
    assert.deepEqual(closed, [1, 0]);
    resetBridge();
  });
});
