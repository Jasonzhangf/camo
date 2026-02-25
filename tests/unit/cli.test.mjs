import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../..');
const CLI_PATH = path.join(REPO_ROOT, 'src', 'cli.mjs');
const PKG_VERSION = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;

describe('CLI module', () => {
  it('should be importable', async () => {
    const cli = await import('../../src/cli.mjs');
    assert.ok(cli);
  });

  it('supports version flags and command', () => {
    for (const arg of ['--version', '-v', 'version']) {
      const ret = spawnSync(process.execPath, [CLI_PATH, arg], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
      });
      assert.strictEqual(ret.status, 0, `${arg} should exit with code 0`);
      assert.strictEqual(String(ret.stderr || '').trim(), '', `${arg} should not print stderr`);
      assert.strictEqual(String(ret.stdout || '').trim(), PKG_VERSION, `${arg} should print package version`);
    }
  });
});
