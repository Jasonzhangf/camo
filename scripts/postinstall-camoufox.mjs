#!/usr/bin/env node
// Post-install hook: ensure Camoufox is installed and verified.
// This runs after 'npm install' in the project directory.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const isWin = os.platform() === 'win32';

async function main() {
  const silent = process.argv.includes('--silent');
  
  if (!silent) {
    console.log('\n=== Camoufox Setup ===\n');
  }
  
  const homedir = os.homedir();
  const cacheDir = isWin 
    ? path.join(homedir, 'AppData', 'Local', 'camoufox')
    : os.platform() === 'darwin'
      ? path.join(homedir, 'Library', 'Caches', 'camoufox')
      : path.join(homedir, '.cache', 'camoufox');
  
  const resourcesDir = path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources');
  const macosDir = path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS');
  const symlinkTarget = path.join(macosDir, 'properties.json');
  const symlinkSource = path.join(resourcesDir, 'properties.json');

  // Step 1: Download if needed
  if (!silent) console.log('[1/4] Checking Camoufox binary...');
  const needsDownload = !fs.existsSync(symlinkSource);
  
  if (needsDownload) {
    if (!silent) console.log('  Downloading (may take a few minutes)...');
    try {
      const result = spawnSync('npx', ['camoufox', 'fetch'], {
        stdio: silent ? 'pipe' : 'inherit',
        timeout: 300000,
      });
      if (result.status !== 0) {
        if (!silent) console.error('  ERROR: camoufox fetch failed');
        return false;
      }
    } catch (err) {
      if (!silent) console.error('  ERROR:', err.message);
      return false;
    }
  } else if (!silent) {
    console.log('  Already present');
  }

  // Step 2: Symlink fix
  if (!silent) console.log('\n[2/4] Applying workaround...');
  
  if (!fs.existsSync(cacheDir)) {
    if (!silent) console.error('  ERROR: cache dir not found:', cacheDir);
    return false;
  }
  
  if (fs.existsSync(symlinkTarget)) {
    const stats = fs.lstatSync(symlinkTarget);
    if (stats.isSymbolicLink()) {
      const existingTarget = fs.readlinkSync(symlinkTarget);
      if (existingTarget === symlinkSource || fs.existsSync(existingTarget)) {
        if (!silent) console.log('  Symlink OK');
      } else {
        fs.unlinkSync(symlinkTarget);
        fs.symlinkSync(symlinkSource, symlinkTarget);
        if (!silent) console.log('  Symlink updated');
      }
    } else if (!silent) {
      console.log('  properties.json exists directly');
    }
  } else {
    fs.symlinkSync(symlinkSource, symlinkTarget);
    if (!silent) console.log('  Symlink created');
  }

  // Step 3: Permissions
  if (!silent) console.log('\n[3/4] Setting permissions...');
  try {
    spawnSync('chmod', ['-R', '755', cacheDir], { stdio: 'ignore' });
    if (!silent) console.log('  Done');
  } catch {}

  // Step 4: Verify
  if (!silent) console.log('\n[4/4] Verifying...');
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
      if (!silent) console.log('  Verification PASSED');
      return true;
    } else {
      if (!silent) {
        console.error('  Verification FAILED');
        console.error('  Output:', output);
      }
      return false;
    }
  } catch (err) {
    if (!silent) console.error('  ERROR:', err.message);
    return false;
  }
}

main().then(ok => {
  if (!ok) {
    console.error('\nWARNING: Camoufox setup had issues.');
    console.error('  Run manually: npx camoufox fetch');
  }
  process.exit(ok ? 0 : 1);
});
