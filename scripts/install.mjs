#!/usr/bin/env node
/**
 * camo CLI Global Installer
 * Usage: node scripts/install.mjs [--prefix /usr/local]
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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

  console.log(`Installing camo CLI...`);
  console.log(`  Prefix: ${prefix}`);
  console.log(`  Target: ${targetDir}`);
  console.log(`  Bin: ${binDir}`);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  const thisDir = path.dirname(new URL(import.meta.url).pathname);
  const moduleDir = path.resolve(thisDir, '..');
  const srcFile = path.join(moduleDir, 'bin', 'camoufox.mjs');

  if (!fs.existsSync(srcFile)) {
    console.error(`Source not found: ${srcFile}`);
    console.error('Run: cp src/cli.mjs bin/camoufox.mjs');
    process.exit(1);
  }

  const targetFile = path.join(targetDir, 'camoufox.mjs');
  fs.copyFileSync(srcFile, targetFile);
  fs.chmodSync(targetFile, 0o755);

  const binPath = path.join(binDir, 'camo');
  const wrapper = `#!/usr/bin/env sh
exec node "${targetFile}" "$@"`;
  fs.writeFileSync(binPath, wrapper);
  fs.chmodSync(binPath, 0o755);

  console.log(`\n✅ camo CLI installed!`);
  console.log(`\nAdd to PATH if needed:`);
  console.log(`  export PATH="${binDir}:$PATH"`);
  console.log(`\nUsage: camo --help`);
}

install();
