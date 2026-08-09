import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);

test('npm package excludes nested dependency trees', () => {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const [manifest] = JSON.parse(output);
  const dependencyEntries = manifest.files.filter(({ path }) => (
    path.startsWith('node_modules/') || path.includes('/node_modules/')
  ));

  assert.deepEqual(dependencyEntries, []);
});

test('v2 package boundary explicitly excludes its local node_modules', () => {
  const npmIgnore = readFileSync(resolve(REPO_ROOT, 'v2/.npmignore'), 'utf8');

  assert.match(npmIgnore, /^node_modules\/$/m);
});

test('published runtime pins the Camoufox protocol client version', () => {
  const packageJson = require(resolve(REPO_ROOT, 'package.json'));
  const packageLock = require(resolve(REPO_ROOT, 'package-lock.json'));

  assert.equal(packageJson.dependencies.camoufox, '0.1.19');
  assert.equal(packageJson.dependencies['playwright-core'], '1.60.0');
  assert.equal(packageLock.packages['node_modules/camoufox'].version, '0.1.19');
  assert.equal(packageLock.packages['node_modules/playwright-core'].version, '1.60.0');
});
