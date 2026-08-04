#!/usr/bin/env node
// camo v2 global installer. Stage 6 is v2-only; install the v2 entry shims.
// Also handles Camoufox binary download, symlink fix, and verification.
// Usage: node scripts/install.mjs [--prefix /usr/local]
import { execSync, spawnSync } from 'node:child_process';
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

/**
 * Install and verify Camoufox browser binary.
 * Handles the camoufox npm bug where properties.json is expected in MacOS/ but lives in Resources/.
 */
async function installAndVerifyCamoufox() {
  console.log('\n=== Camoufox Browser Setup ===\n');
  
  const homedir = os.homedir();
  const cacheDir = os.platform() === 'win32' 
    ? path.join(homedir, 'AppData', 'Local', 'camoufox')
    : os.platform() === 'darwin'
      ? path.join(homedir, 'Library', 'Caches', 'camoufox')
      : path.join(homedir, '.cache', 'camoufox');
  
  const resourcesDir = path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources');
  const macosDir = path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS');
  const symlinkTarget = path.join(macosDir, 'properties.json');
  const symlinkSource = path.join(resourcesDir, 'properties.json');

  // Step 1: Download Camoufox binary if not present or outdated
  console.log('[1/4] Checking Camoufox binary...');
  const needsDownload = !fs.existsSync(symlinkSource);
  
  if (needsDownload) {
    console.log('  Downloading Camoufox binary (this may take a few minutes)...');
    try {
      const result = spawnSync('npx', ['camoufox', 'fetch'], {
        stdio: 'inherit',
        timeout: 300000,
      });
      if (result.status !== 0) {
        console.error('  ERROR: camoufox fetch failed');
        return false;
      }
    } catch (err) {
      console.error('  ERROR: Failed to download Camoufox:', err.message);
      return false;
    }
  } else {
    console.log('  Camoufox binary already present');
  }

  // Step 2: Fix symlink workaround for camoufox npm bug
  console.log('\n[2/4] Applying Camoufox workaround (symlink fix)...');
  
  if (!fs.existsSync(cacheDir)) {
    console.error('  ERROR: Camoufox cache directory not found:', cacheDir);
    return false;
  }
  
  if (fs.existsSync(symlinkTarget)) {
    const stats = fs.lstatSync(symlinkTarget);
    if (stats.isSymbolicLink()) {
      const existingTarget = fs.readlinkSync(symlinkTarget);
      if (existingTarget === symlinkSource || fs.existsSync(existingTarget)) {
        console.log('  Symlink already correct');
      } else {
        fs.unlinkSync(symlinkTarget);
        fs.symlinkSync(symlinkSource, symlinkTarget);
        console.log('  Symlink updated');
      }
    } else {
      console.log('  properties.json exists directly in MacOS/ (no symlink needed)');
    }
  } else {
    fs.symlinkSync(symlinkSource, symlinkTarget);
    console.log('  Symlink created');
  }

  // Step 3: Set execute permissions
  console.log('\n[3/4] Setting execute permissions...');
  try {
    spawnSync('chmod', ['-R', '755', cacheDir], { stdio: 'ignore' });
    console.log('  Permissions set');
  } catch {}

  // Step 4: Verify Camoufox can launch
  console.log('\n[4/4] Verifying Camoufox installation...');
  try {
    const testScript = `
      const { Camoufox } = require('camoufox');
      (async () => {
        const browser = await Camoufox({ headless: true, iKnowWhatImDoing: true });
        const page = await browser.newPage();
        await page.goto('https://example.com');
        const title = await page.title();
        await browser.close();
        console.log('TITLE:' + title);
        process.exit(0);
      })().catch(e => { console.error('ERROR:' + e.message); process.exit(1); });
    `;
    const result = spawnSync('node', ['-e', testScript], {
      stdio: 'pipe',
      timeout: 30000,
    });
    const output = result.stdout?.toString() || '';
    if (output.includes('TITLE:Example Domain')) {
      console.log('  Camoufox verification PASSED');
      console.log('\n=== Camoufox Setup Complete ===\n');
      return true;
    } else {
      console.error('  ERROR: Camoufox verification failed');
      console.error('  Output:', output);
      console.error('  Stderr:', result.stderr?.toString());
      return false;
    }
  } catch (err) {
    console.error('  ERROR: Verification script failed:', err.message);
    return false;
  }
}

async function install() {
  const prefix = detectPrefix();
  const binDir = path.join(prefix, 'bin');
  const targetDir = path.join(prefix, 'share', 'camo');

  console.log('Installing camo CLI (v2)...');
  console.log('  Prefix: ' + prefix);
  console.log('  Target: ' + targetDir);
  console.log('  Bin: ' + binDir);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  // Get correct repo root: scripts/ -> repo root
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), '..');
  console.log('  Source: ' + repoRoot);

  // Copy the v2 entry point and runtime artifacts.
  for (const rel of ['bin', 'bin/camo', 'bin/camo.mjs', 'v2', 'package.json']) {
    const src = path.join(repoRoot, rel);
    const dst = path.join(targetDir, rel);
    if (!fs.existsSync(src)) {
      console.error('Missing artifact: ' + src);
      process.exit(1);
    }
    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
      copyDir(src, dst);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  fs.chmodSync(path.join(targetDir, 'bin/camo.mjs'), 0o755);

  // Install dependencies in target directory
  console.log('\nInstalling dependencies in target directory...');
  try {
    const result = spawnSync('npm', ['install', '--omit=dev'], {
      cwd: targetDir,
      stdio: 'inherit',
      timeout: 120000,
    });
    if (result.status !== 0) {
      console.error('  WARNING: npm install had issues');
    } else {
      console.log('  Dependencies installed');
    }
  } catch (err) {
    console.error('  WARNING: Failed to install dependencies:', err.message);
  }

  const binPath = path.join(binDir, 'camo');
  const wrapper = '#!/usr/bin/env sh\nexec node "' + path.join(targetDir, 'bin/camo.mjs') + '" "$@"';
  fs.writeFileSync(binPath, wrapper);
  fs.chmodSync(binPath, 0o755);

  // Install and verify Camoufox
  console.log('');
  const camoResult = await installAndVerifyCamoufox();
  
  if (!camoResult) {
    console.error('\nWARNING: Camoufox setup had issues, but camo CLI is installed.');
    console.error('  You may need to fix Camoufox manually before using browser features.');
    console.error('  Try: npx camoufox fetch');
  }

  console.log('\ncamo CLI installed!\n');
  console.log('Add to PATH if needed:');
  console.log('  export PATH="' + binDir + ':$PATH"');
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

await install();
