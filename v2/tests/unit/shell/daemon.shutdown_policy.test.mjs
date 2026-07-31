import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';
import { shutdownDaemonResources } from '../../../shell/daemon/shutdown_policy.mjs';

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit);
    } else if (value && typeof value.type === 'string') {
      walk(value, visit);
    }
  }
}

test('negative: ephemeral command cleanup has one physical invocation and no catch retry', () => {
  const source = fs.readFileSync(
    new URL('../../../shell/daemon/index.mjs', import.meta.url),
    'utf8',
  );
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  let handleCommand = null;
  walk(ast, (node) => {
    if (node.type === 'FunctionDeclaration' && node.id?.name === 'handleCommand') {
      handleCommand = node;
    }
  });
  assert.ok(handleCommand, 'handleCommand must exist');

  let cleanupCalls = 0;
  let cleanupCallsInsideCatch = 0;
  walk(handleCommand.body, (node) => {
    if (
      node.type === 'CallExpression'
      && node.callee?.type === 'Identifier'
      && node.callee.name === 'releaseBrowser'
    ) {
      cleanupCalls += 1;
    }
    if (node.type === 'CatchClause') {
      walk(node.body, (child) => {
        if (
          child.type === 'CallExpression'
          && child.callee?.type === 'Identifier'
          && child.callee.name === 'releaseBrowser'
        ) {
          cleanupCallsInsideCatch += 1;
        }
      });
    }
  });
  assert.equal(cleanupCalls, 1, 'ephemeral cleanup must have one physical call site');
  assert.equal(cleanupCallsInsideCatch, 0, 'catch path must not retry cleanup');
});

test('negative: browser shutdown failure preserves registration, claim, servers, and lifecycle truth', async () => {
  const calls = [];
  const browserFailure = new Error('browser close failed');

  const result = await shutdownDaemonResources({
    shutdownBrowsers: async () => {
      calls.push('browser');
      throw browserFailure;
    },
    clearBrowserTruth: () => calls.push('truth'),
    releaseRegistration: async () => calls.push('registration'),
    closeServers: async () => calls.push('servers'),
  });

  assert.deepEqual(calls, ['browser']);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'browser_service');
  assert.equal(result.cause, browserFailure);
});

test('positive: successful shutdown releases resources in ownership order', async () => {
  const calls = [];

  const result = await shutdownDaemonResources({
    shutdownBrowsers: async () => calls.push('browser'),
    clearBrowserTruth: () => calls.push('truth'),
    releaseRegistration: async () => calls.push('registration'),
    closeServers: async () => calls.push('servers'),
  });

  assert.deepEqual(calls, ['browser', 'truth', 'servers', 'registration']);
  assert.deepEqual(result, { ok: true });
});

test('negative: server failure preserves registration truth', async () => {
  const calls = [];
  const serverFailure = new Error('server close failed');

  const result = await shutdownDaemonResources({
    shutdownBrowsers: async () => calls.push('browser'),
    clearBrowserTruth: () => calls.push('truth'),
    releaseRegistration: async () => calls.push('registration'),
    closeServers: async () => {
      calls.push('servers');
      throw serverFailure;
    },
  });

  assert.deepEqual(calls, ['browser', 'truth', 'servers']);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'servers');
  assert.equal(result.cause, serverFailure);
});

test('negative: registration failure is exposed after servers close', async () => {
  const calls = [];
  const registrationFailure = new Error('registration release failed');

  const result = await shutdownDaemonResources({
    shutdownBrowsers: async () => calls.push('browser'),
    clearBrowserTruth: () => calls.push('truth'),
    releaseRegistration: async () => {
      calls.push('registration');
      throw registrationFailure;
    },
    closeServers: async () => calls.push('servers'),
  });

  assert.deepEqual(calls, ['browser', 'truth', 'servers', 'registration']);
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'registration');
  assert.equal(result.cause, registrationFailure);
});
