#!/usr/bin/env node
// camo v2 global installer. Stage 6 is v2-only; install the v2 entry shims.
// Usage: node scripts/install.mjs [--prefix /usr/local]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const isWin = os.platform() === 'win32';

function detectPrefix() {
  const prefixIdx = process.argv.indexOf('--prefix');
  if (prefixIdx >= 0 && process.argv[prefixIdx + 1]) {
    return process.argv[prefixIdx + 1];
  }

  const candidates = [
    isWin ? path.join(os.homedir(), 'AppData', 'Local', 'camo') : null,
    '/opt/homebrew',
    '/usr/local',
    '/usr',
    path.join(os.homedir(), '.local'),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      fs.accessSync(path.dirname(p), fs.constants.W_OK);
      return p;
    } catch {}
  }
  return path.join(os.homedir(), '.local');
}

function install() {
  const prefix = detectPrefix();
  const binDir = path.join(prefix, 'bin');
  const targetDir = path.join(prefix, 'share', 'camo');

  console.log('Installing camo CLI (v2)...');
  console.log(`  Prefix: ${prefix}`);
  console.log(`  Target: ${targetDir}`);
  console.log(`  Bin: ${binDir}`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  const moduleDir = path.dirname(fileURLToPath(import.meta.url)) + '/..';
  const repoRoot = path.resolve(moduleDir);

  // Copy the v2 entry point and runtime artifacts.
  for (const rel of ['bin/camo', 'bin/camo.mjs', 'v2']) {
    const src = path.join(repoRoot, rel);
    const dst = path.join(targetDir, rel);
    if (!fs.existsSync(src)) {
      console.error(`Missing artifact: ${src}`);
      process.exit(1);
    }
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDir(src, dst);
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  fs.chmodSync(path.join(targetDir, 'bin/camo.mjs'), 0o755);

  const binPath = path.join(binDir, 'camo');
  const wrapper = `#!/usr/bin/env sh
exec node "${path.join(targetDir, 'bin/camo.mjs')}" "$@"`;
  fs.writeFileSync(binPath, wrapper);
  fs.chmodSync(binPath, 0o755);

  console.log('\ncamo CLI installed!\n');
  console.log('Add to PATH if needed:');
  console.log(`  export PATH="${binDir}:$PATH"`);
  console.log('\nUsage: camo --help');
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, e.name);
    const dp = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(sp, dp);
    else if (e.isFile()) {
      fs.copyFileSync(sp, dp);
    }
  }
}

install();
