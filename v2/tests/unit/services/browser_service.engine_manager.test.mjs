import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(
  new URL('../../../services/browser_service/internal/engine-manager.mjs', import.meta.url),
  'utf8',
);

test('positive: Camoufox native mouse humanization is disabled', () => {
  assert.match(source, /\bhumanize:\s*false\b/);
  assert.doesNotMatch(source, /\bhumanize:\s*true\b/);
});

test('negative: Camoufox acknowledgement uses only the supported snake-case option', () => {
  assert.match(source, /\bi_know_what_im_doing:\s*true\b/);
  assert.doesNotMatch(source, /\biKnowWhatImDoing\b/);
});
