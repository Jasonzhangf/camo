/**
 * Check if Camoufox is installed and working.
 * Returns { ok: boolean, error?: string }
 */
async function checkCamoufoxHealth() {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const { spawnSync } = await import('node:child_process');

  const homedir = os.homedir();
  const isWin = os.platform() === 'win32';
  const cacheDir = isWin 
    ? path.join(homedir, 'AppData', 'Local', 'camoufox')
    : os.platform() === 'darwin'
      ? path.join(homedir, 'Library', 'Caches', 'camoufox')
      : path.join(homedir, '.cache', 'camoufox');
  
  const resourcesProps = path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json');
  const macosProps = path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS', 'properties.json');

  // Check 1: properties.json exists in Resources (the real location)
  if (!fs.existsSync(resourcesProps)) {
    return { ok: false, error: 'Camoufox binary not found. Run: npx camoufox fetch' };
  }

  // Check 2: symlink exists (workaround for npm bug)
  if (!fs.existsSync(macosProps)) {
    try {
      fs.symlinkSync(resourcesProps, macosProps);
    } catch {}
  }

  // Check 3: verify Camoufox can actually launch
  try {
    const testScript = `
      const { Camoufox } = require('camoufox');
      (async () => {
        const browser = await Camoufox({ headless: true, iKnowWhatImDoing: true });
        const page = await browser.newPage();
        await page.goto('https://example.com');
        await browser.close();
        process.exit(0);
      })().catch(e => { process.exit(1); });
    `;
    const result = spawnSync(process.execPath, ['-e', testScript], {
      stdio: 'pipe',
      timeout: 30000,
      cwd: process.env.CAMO_PKG_ROOT || process.cwd(),
    });
    if (result.status === 0) {
      return { ok: true };
    } else {
      const err = result.stderr?.toString() || 'Unknown error';
      return { ok: false, error: 'Camoufox launch failed: ' + err.slice(0, 200) };
    }
  } catch (err) {
    return { ok: false, error: 'Camoufox check failed: ' + err.message };
  }
}

/**
 * Ensure Camoufox is installed and working. Auto-fetches if missing.
 */
async function ensureCamoufox() {
  const health = await checkCamoufoxHealth();
  if (health.ok) return;

  // Auto-download if not present
  if (health.error?.includes('not found')) {
    console.error('Camoufox not found, downloading...');
    const { spawn } = await import('node:child_process');
    const result = spawn('npx', ['camoufox', 'fetch'], { stdio: 'inherit' });
    await new Promise(r => { result.on('close', r); });
    
    // Retry health check
    const retry = await checkCamoufoxHealth();
    if (!retry.ok) {
      throw new Error('Camoufox setup failed: ' + retry.error);
    }
  } else {
    throw new Error('Camoufox unhealthy: ' + health.error);
  }
}

export { checkCamoufoxHealth, ensureCamoufox };
