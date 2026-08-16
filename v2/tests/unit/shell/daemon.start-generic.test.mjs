import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('start handler contains no provider-specific login policy or response field', () => {
  const source = fs.readFileSync(
    new URL('../../../shell/daemon/command_handlers.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /Google|OpenCode|opencode|loginHint/);
});
