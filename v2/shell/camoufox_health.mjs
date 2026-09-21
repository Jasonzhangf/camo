/**
 * Check Camoufox installation readiness.
 * Browser launch verification belongs to daemon.browser_service.
 */
const CAMOUFOX_RUNTIME_CONTRACT = Object.freeze({
  camoufoxVersion: '152.0.4',
  camoufoxRelease: 'beta.29',
  playwrightCoreVersion: '1.60.0',
});

function camoufoxArchiveUrl() {
  const { camoufoxVersion, camoufoxRelease } = CAMOUFOX_RUNTIME_CONTRACT;
  const platform = process.platform === 'win32'
    ? 'win'
    : process.platform === 'darwin'
      ? 'mac'
      : 'lin';
  const arch = process.arch === 'arm64'
    ? 'arm64'
    : process.arch === 'x64'
      ? 'x86_64'
      : process.arch;
  return `https://github.com/daijro/camoufox/releases/download/v${camoufoxVersion}-${camoufoxRelease}/camoufox-${camoufoxVersion}-${camoufoxRelease}-${platform}.${arch}.zip`;
}

function validateCamoufoxRuntimeVersions({
  camoufoxVersion,
  camoufoxRelease,
  playwrightCoreVersion,
}) {
  if (typeof camoufoxVersion !== 'string' || typeof camoufoxRelease !== 'string') {
    return {
      ok: false,
      errorCode: 'E_CAMOUFOX_VERSION_INVALID',
      repairable: false,
      error: 'Camoufox version manifest must contain string version and release fields',
    };
  }

  if (
    camoufoxVersion !== CAMOUFOX_RUNTIME_CONTRACT.camoufoxVersion
    || camoufoxRelease !== CAMOUFOX_RUNTIME_CONTRACT.camoufoxRelease
  ) {
    return {
      ok: false,
      errorCode: 'E_CAMOUFOX_BINARY_INCOMPATIBLE',
      repairable: true,
      error: `Camoufox ${camoufoxVersion}-${camoufoxRelease} is incompatible; expected ${CAMOUFOX_RUNTIME_CONTRACT.camoufoxVersion}-${CAMOUFOX_RUNTIME_CONTRACT.camoufoxRelease}`,
    };
  }

  if (playwrightCoreVersion !== CAMOUFOX_RUNTIME_CONTRACT.playwrightCoreVersion) {
    return {
      ok: false,
      errorCode: 'E_CAMOUFOX_PROTOCOL_INCOMPATIBLE',
      repairable: false,
      error: `playwright-core ${playwrightCoreVersion || 'unknown'} is incompatible; expected ${CAMOUFOX_RUNTIME_CONTRACT.playwrightCoreVersion}`,
    };
  }

  return { ok: true };
}

async function readResolvedPlaywrightCoreVersion() {
  const { createRequire } = await import('node:module');
  const rootRequire = createRequire(import.meta.url);
  const camoufoxEntry = rootRequire.resolve('camoufox');
  const camoufoxRequire = createRequire(camoufoxEntry);
  return camoufoxRequire('playwright-core/package.json').version;
}

async function checkCamoufoxHealth() {
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');

  const homedir = os.homedir();
  const isWin = os.platform() === 'win32';
  const executableEnv = String(process.env.CAMO_EXECUTABLE_PATH || '').trim();
  // CAMO_EXECUTABLE_PATH points at <cache>/Camoufox.app/Contents/MacOS/camoufox;
  // derive the cache root from it so isolated HOMEs still resolve the real
  // installed binary instead of triggering a download.
  const cacheDir = executableEnv
    ? path.resolve(path.dirname(executableEnv), '..', '..', '..')
    : isWin
      ? path.join(homedir, 'AppData', 'Local', 'camoufox')
      : os.platform() === 'darwin'
        ? path.join(homedir, 'Library', 'Caches', 'camoufox')
        : path.join(homedir, '.cache', 'camoufox');
  
  const resourcesProps = path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json');
  const macosProps = path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS', 'properties.json');
  const versionPath = path.join(cacheDir, 'version.json');

  // Check 1: properties.json exists in Resources (the real location)
  if (!fs.existsSync(resourcesProps)) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_BINARY_MISSING',
      repairable: true,
      error: 'Camoufox binary not found. Run: npx camoufox fetch',
    };
  }

  if (!fs.existsSync(versionPath)) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_VERSION_MISSING',
      repairable: true,
      error: `Camoufox version manifest not found: ${versionPath}`,
    };
  }

  let installedVersion;
  try {
    installedVersion = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
  } catch (cause) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_VERSION_INVALID',
      repairable: false,
      error: `Camoufox version manifest is invalid: ${cause?.message || cause}`,
    };
  }

  let playwrightCoreVersion;
  try {
    playwrightCoreVersion = await readResolvedPlaywrightCoreVersion();
  } catch (cause) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_PROTOCOL_INCOMPATIBLE',
      repairable: false,
      error: `Unable to resolve Camoufox playwright-core version: ${cause?.message || cause}`,
    };
  }

  const compatibility = validateCamoufoxRuntimeVersions({
    camoufoxVersion: installedVersion?.version,
    camoufoxRelease: installedVersion?.release,
    playwrightCoreVersion,
  });
  if (!compatibility.ok) {
    return {
      ...compatibility,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
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
        errorCode: 'E_CAMOUFOX_INSTALL_LAYOUT_INVALID',
        repairable: false,
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
    versionPath,
    camoufoxVersion: installedVersion.version,
    camoufoxRelease: installedVersion.release,
    playwrightCoreVersion,
  };
}

/**
 * Ensure Camoufox installation is ready. Auto-fetches if missing.
 */
async function ensureCamoufox({ spawnImpl } = {}) {
  const health = await checkCamoufoxHealth();
  if (health.ok) return health;

  if (!health.repairable) {
    throw new Error('Camoufox unhealthy: ' + health.error);
  }

  console.error('Camoufox runtime is missing or incompatible, fetching the admitted binary...');
  const os = await import('node:os');
  const path = await import('node:path');
  const fs = await import('node:fs');
  const { spawn } = await import('node:child_process');
  const run = spawnImpl || spawn;
  const cacheDir = process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local', 'camoufox')
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Caches', 'camoufox')
      : path.join(os.homedir(), '.cache', 'camoufox');
  // Stage beside the cache root. The install replaces cacheDir below, so a
  // staging directory nested inside it would be deleted before extraction.
  const downloadDir = path.join(
    path.dirname(cacheDir),
    `.camoufox-download-${process.pid}-${Date.now()}`,
  );
  const archivePath = path.join(downloadDir, 'camoufox.zip');

  fs.mkdirSync(downloadDir, { recursive: true });
  try {
    const curl = run('curl', ['-fL', '--retry', '3', '--connect-timeout', '15', '-o', archivePath, camoufoxArchiveUrl()], { stdio: 'inherit' });
    const curlExitCode = await new Promise((resolve, reject) => {
      curl.once('error', reject);
      curl.once('close', resolve);
    });
    if (curlExitCode !== 0) {
      throw new Error(`Camoufox archive download failed with exit code ${curlExitCode}`);
    }

    const unzip = run('unzip', ['-q', '-o', archivePath, '-d', downloadDir], { stdio: 'inherit' });
    const unzipExitCode = await new Promise((resolve, reject) => {
      unzip.once('error', reject);
      unzip.once('close', resolve);
    });
    if (unzipExitCode !== 0) {
      throw new Error(`Camoufox archive extraction failed with exit code ${unzipExitCode}`);
    }

    fs.rmSync(cacheDir, { recursive: true, force: true });
    fs.mkdirSync(cacheDir, { recursive: true });
    for (const entry of fs.readdirSync(downloadDir)) {
      if (entry === 'camoufox.zip') continue;
      fs.renameSync(path.join(downloadDir, entry), path.join(cacheDir, entry));
    }
    fs.writeFileSync(
      path.join(cacheDir, 'version.json'),
      JSON.stringify({
        version: CAMOUFOX_RUNTIME_CONTRACT.camoufoxVersion,
        release: CAMOUFOX_RUNTIME_CONTRACT.camoufoxRelease,
      }),
      'utf8',
    );
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }

  const retry = await checkCamoufoxHealth();
  if (!retry.ok) {
    throw new Error('Camoufox setup failed: ' + retry.error);
  }
  return retry;
}

export {
  CAMOUFOX_RUNTIME_CONTRACT,
  checkCamoufoxHealth,
  ensureCamoufox,
  validateCamoufoxRuntimeVersions,
};
