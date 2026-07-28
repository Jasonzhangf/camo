import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { list } from '../../../commands/registry/registry.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(__dirname, '../../../commands/docstrings');

test('positive: every registry cmd has a docstring file with content', () => {
  const cmds = list();
  for (const c of cmds) {
    const file = path.join(DOC_DIR, `${c}.md`);
    assert.ok(fs.existsSync(file), `missing docstring: ${file}`);
    const body = fs.readFileSync(file, 'utf8');
    assert.ok(body.length > 30, `${c}.md must have content`);
  }
});
