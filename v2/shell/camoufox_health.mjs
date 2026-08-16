/**
 * Check Camoufox installation readiness.
 * Browser launch verification belongs to daemon.browser_service.
 */
async function checkCamoufoxHealth() {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');

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
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      error: 'Camoufox binary not found. Run: npx camoufox fetch',
    };
  }

  // Check 2: symlink exists (workaround for npm bug)
  if (!fs.existsSync(macosProps)) {
    try {
      fs.symlinkSync(resourcesProps, macosProps);
    } catch (cause) {
      return {
        ok: false,
        launchVerified: false,
        launchOwner: 'daemon.browser_service',
        error: `Camoufox installation repair failed: ${cause?.message || cause}`,
      };
    }
  }

  // Check 3: installation is present. Real launch correctness is owned by
  // the daemon browser-service, which surfaces launch failures with proper
  // error envelopes. Launching a full browser synchronously here, on every
  // CLI browser command, caused repeated browser spawn/teardown and could
  // block forever: spawnSync timeout kills the probe child, but the probe's
  // Camoufox grandchild keeps the inherited stdout/stderr pipes open, so the
  // CLI waits on pipe EOF indefinitely before ever reaching the daemon.
  // This check reports INSTALL readiness only; it must never claim that the
  // browser has been verified to launch. launchVerified: false is contract.
  return {
    ok: true,
    launchVerified: false,
    launchOwner: 'daemon.browser_service',
    installPath: resourcesProps,
  };
}

/**
 * Ensure Camoufox installation is ready. Auto-fetches if missing.
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
