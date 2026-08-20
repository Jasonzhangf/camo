import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from 'acorn';

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

function containsIdentifier(node, name) {
  let found = false;
  walk(node, (child) => {
    if (child.type === 'Identifier' && child.name === name) found = true;
  });
  return found;
}

function containsString(node, value) {
  let found = false;
  walk(node, (child) => {
    if (child.type === 'Literal' && child.value === value) found = true;
  });
  return found;
}

function findNode(root, predicate) {
  let found = null;
  walk(root, (node) => {
    if (!found && predicate(node)) found = node;
  });
  return found;
}

test('positive: every successful profile command refreshes idle activity', () => {
  const source = fs.readFileSync(
    new URL('../../../shell/daemon/index.mjs', import.meta.url),
    'utf8',
  );
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const handleCommand = findNode(ast, (node) => (
    node.type === 'FunctionDeclaration' && node.id?.name === 'handleCommand'
  ));
  assert.ok(handleCommand, 'handleCommand must exist');

  const touchCall = findNode(handleCommand.body, (node) => (
    node.type === 'CallExpression'
    && node.callee?.type === 'Identifier'
    && node.callee.name === 'touchSession'
  ));
  assert.ok(touchCall, 'touchSession must be called after successful commands');

  const guard = findGuard(handleCommand.body, touchCall);
  assert.ok(guard, 'activity touch must be guarded by an if statement');
  assert.equal(containsIdentifier(guard.test, 'profile'), true, 'activity touch must require a target profile');
  assert.equal(containsIdentifier(guard.test, 'isBrowserCommand'), false, 'activity must not be limited to isBrowserCommand');
  assert.equal(containsString(guard.test, 'daemon'), true, 'daemon status must not count as profile activity');
});

function findGuard(node, target) {
  if (!node || typeof node !== 'object') return null;
  if (node === target) return node.type === 'IfStatement' ? node : true;
  for (const value of Object.values(node)) {
    const children = Array.isArray(value) ? value : [value];
    for (const child of children) {
      const result = findGuard(child, target);
      if (result) {
        return node.type === 'IfStatement' ? node : result;
      }
    }
  }
  return null;
}
