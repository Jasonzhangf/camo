#!/usr/bin/env node
// Post-install hook: ensure Camoufox is installed and verified.
// This runs after 'npm install' in the project directory.

import {
  camoufoxCacheDir,
  checkCamoufoxHealth,
  ensureCamoufox,
  setCamoufoxPermissions,
} from '../v2/shell/camoufox_health.mjs';

async function main() {
  const silent = process.argv.includes('--silent');
  
  if (!silent) {
    console.log('\n=== Camoufox Setup ===\n');
  }
  
  const cacheDir = camoufoxCacheDir();
  
  // Step 1: Enforce the single admitted browser/protocol pair.
  if (!silent) console.log('[1/4] Checking Camoufox runtime contract...');
  let health = await checkCamoufoxHealth();
  if (!health.ok) {
    if (!health.repairable) {
      if (!silent) console.error('  ERROR:', health.error);
      return false;
    }
    if (!silent) console.log('  Fetching the admitted Camoufox binary...');
    try {
      health = await ensureCamoufox();
    } catch (err) {
      if (!silent) console.error('  ERROR:', err.message);
      return false;
    }
  } else if (!silent) {
    console.log('  Runtime contract matched');
  }

  // Step 2: Recheck the installed layout and exact versions after repair.
  if (!silent) console.log('\n[2/4] Verifying installation layout...');
  health = await checkCamoufoxHealth();
  if (!health.ok) {
    if (!silent) console.error('  ERROR:', health.error);
    return false;
  }
  if (!silent) console.log('  Installation layout OK');

  // Step 3: Permissions
  if (!silent) console.log('\n[3/4] Setting permissions...');
  setCamoufoxPermissions(cacheDir);
  if (!silent) console.log('  Done');

  // Step 4: Report installation readiness. Browser launch truth stays with
  // daemon.browser_service and is verified through the installed camo CLI.
  if (!silent) {
    console.log('\n[4/4] Runtime contract verified');
    console.log(`  Camoufox ${health.camoufoxVersion}-${health.camoufoxRelease}`);
    console.log(`  playwright-core ${health.playwrightCoreVersion}`);
  }
  return true;
}

main().then(ok => {
  if (!ok) {
    console.error('\nWARNING: Camoufox setup had issues.');
    console.error('  Run manually: npx camoufox fetch');
  }
  process.exit(ok ? 0 : 1);
});
