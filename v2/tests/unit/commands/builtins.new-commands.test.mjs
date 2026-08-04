// camo v2 unit tests: new builtins (scroll/screenshot/wait/evaluate/upload/select)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { list, isBuiltin } from '../../../commands/builtins/index.mjs';

describe('builtins.new-commands.index', () => {
  test('list returns all 28 builtins', () => {
    const cmds = list();
    assert.equal(cmds.includes('scroll'), true, 'scroll missing');
    assert.equal(cmds.includes('screenshot'), true, 'screenshot missing');
    assert.equal(cmds.includes('wait'), true, 'wait missing');
    assert.equal(cmds.includes('evaluate'), true, 'evaluate missing');
    assert.equal(cmds.includes('upload'), true, 'upload missing');
    assert.equal(cmds.includes('select'), true, 'select missing');
    assert.equal(cmds.length, 29, `expected 29 builtins, got ${cmds.length}`);
  });

  test('isBuiltin returns true for all new commands', () => {
    assert.equal(isBuiltin('scroll'), true);
    assert.equal(isBuiltin('screenshot'), true);
    assert.equal(isBuiltin('wait'), true);
    assert.equal(isBuiltin('evaluate'), true);
    assert.equal(isBuiltin('upload'), true);
    assert.equal(isBuiltin('select'), true);
  });

  test('isBuiltin returns false for unknown commands', () => {
    assert.equal(isBuiltin('unknown_cmd'), false);
    assert.equal(isBuiltin(''), false);
    assert.equal(isBuiltin(null), false);
  });
});

describe('builtins.new-commands.run-errors', () => {
  test('scroll rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/scroll.mjs');
    await assert.rejects(run(null, {}), /Invalid input/);
  });

  test('screenshot rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/screenshot.mjs');
    await assert.rejects(run(null, {}), /Invalid input/);
  });

  test('wait rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/wait.mjs');
    await assert.rejects(run(null, {}), /Invalid input/);
  });

  test('evaluate rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/evaluate.mjs');
    await assert.rejects(run(null, {}), /Invalid input/);
  });

  test('upload rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/upload.mjs');
    await assert.rejects(run(null, {}), /Invalid input/);
  });

  test('select rejects null transport', async () => {
    const { run } = await import('../../../commands/builtins/select.mjs');
    await assert.rejects(run(null, {}), /Invalid input/);
  });
});

describe('builtins.new-commands.validation', () => {
  test('scroll rejects x=y=0', async () => {
    const { run } = await import('../../../commands/builtins/scroll.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { x: 0, y: 0 } }), /Invalid input/);
  });

  test('scroll rejects non-finite x/y', async () => {
    const { run } = await import('../../../commands/builtins/scroll.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { x: NaN } }), /Invalid input/);
    await assert.rejects(run(transport, { profile: 'test', named: { y: Infinity } }), /Invalid input/);
  });

  test('wait rejects invalid --for value', async () => {
    const { run } = await import('../../../commands/builtins/wait.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { for: 'invalid' } }), /Invalid input/);
  });

  test('wait rejects negative timeout', async () => {
    const { run } = await import('../../../commands/builtins/wait.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { timeout: -100 } }), /Invalid input/);
  });

  test('evaluate rejects empty script', async () => {
    const { run } = await import('../../../commands/builtins/evaluate.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { script: '' } }), /Required field/);
    await assert.rejects(run(transport, { profile: 'test', named: { script: '   ' } }), /Required field/);
  });

  test('upload rejects empty selector', async () => {
    const { run } = await import('../../../commands/builtins/upload.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { selector: '', file: 'f' } }), /Required field/);
  });

  test('upload rejects empty file', async () => {
    const { run } = await import('../../../commands/builtins/upload.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { selector: 'sel', file: '' } }), /Required field/);
  });

  test('select rejects empty selector', async () => {
    const { run } = await import('../../../commands/builtins/select.mjs');
    const transport = { sendFrame: async () => ({ payload: {} }) };
    await assert.rejects(run(transport, { profile: 'test', named: { selector: '', value: 'v' } }), /Required field/);
  });
});
