import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const source = fs.readFileSync(path.join(repoRoot, 'scripts/postinstall-camoufox.mjs'), 'utf8');

test('positive: postinstall consumes the canonical Camoufox health and repair owner', () => {
  assert.match(source, /import \{ checkCamoufoxHealth, ensureCamoufox \}/);
  assert.match(source, /await ensureCamoufox\(\)/);
  assert.match(source, /await checkCamoufoxHealth\(\)/);
});

test('negative: postinstall does not bypass the owner with presence-only or direct launch logic', () => {
  assert.doesNotMatch(source, /needsDownload/);
  assert.doesNotMatch(source, /require\(['"]camoufox['"]\)/);
  assert.doesNotMatch(source, /\bCamoufox\s*\(/);
  assert.doesNotMatch(source, /\['camoufox',\s*'fetch'\]/);
});
