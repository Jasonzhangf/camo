/**
 * Check Camoufox installation readiness.
 * Browser launch verification belongs to daemon.browser_service.
 */
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const CAMOUFOX_RUNTIME_CONTRACT = Object.freeze({
  camoufoxVersion: '152.0.4',
  camoufoxRelease: 'beta.29',
  playwrightCoreVersion: '1.60.0',
});

function camoufoxPlatform(platform = process.platform) {
  return platform === 'win32'
    ? 'win'
    : platform === 'darwin'
      ? 'mac'
      : 'lin';
}

function camoufoxArch(arch = process.arch) {
  if (arch === 'x64') return 'x86_64';
  if (arch === 'ia32') return 'i686';
  if (arch === 'arm64' || arch === 'arm') return 'arm64';
  return arch;
}

function camoufoxCacheDir({
  platform = process.platform,
  homedir = os.homedir(),
} = {}) {
  if (platform === 'win32') {
    return path.join(homedir, 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache');
  }
  return platform === 'darwin'
    ? path.join(homedir, 'Library', 'Caches', 'camoufox')
    : path.join(homedir, '.cache', 'camoufox');
}

function camoufoxInstallPaths({
  platform = process.platform,
  homedir = os.homedir(),
  cacheDir = camoufoxCacheDir({ platform, homedir }),
} = {}) {
  const versionPath = path.join(cacheDir, 'version.json');
  if (platform === 'darwin') {
    return {
      cacheDir,
      executablePath: path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS', 'camoufox'),
      propertiesPath: path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json'),
      macosPropertiesPath: path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS', 'properties.json'),
      versionPath,
    };
  }
  return {
    cacheDir,
    executablePath: path.join(
      cacheDir,
      platform === 'win32' ? 'camoufox.exe' : 'camoufox-bin',
    ),
    propertiesPath: path.join(cacheDir, 'properties.json'),
    macosPropertiesPath: null,
    versionPath,
  };
}

function cacheDirFromExecutable(executablePath, platform = process.platform) {
  const executableDir = path.dirname(executablePath);
  return platform === 'darwin'
    ? path.resolve(executableDir, '..', '..', '..')
    : executableDir;
}

// Explicit CAMO_EXECUTABLE_PATH points at an installation Camo does not own.
// It may be checked, but never auto-repaired: the repair path replaces the
// installation root, and an arbitrary explicit path would make Camo
// recursive-delete a directory outside its own cache.
function explicitCamoufoxExecutable(explicit = process.env.CAMO_EXECUTABLE_PATH) {
  return String(explicit || '').trim();
}

function resolveCamoufoxCacheDir({
  platform = process.platform,
  homedir = os.homedir(),
  explicitExecutable = explicitCamoufoxExecutable(),
} = {}) {
  return explicitExecutable
    ? cacheDirFromExecutable(explicitExecutable, platform)
    : camoufoxCacheDir({ platform, homedir });
}

function camoufoxArchiveUrl({
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const { camoufoxVersion, camoufoxRelease } = CAMOUFOX_RUNTIME_CONTRACT;
  const platformName = camoufoxPlatform(platform);
  const archName = camoufoxArch(arch);
  return `https://github.com/daijro/camoufox/releases/download/v${camoufoxVersion}-${camoufoxRelease}/camoufox-${camoufoxVersion}-${camoufoxRelease}-${platformName}.${archName}.zip`;
}

function setCamoufoxPermissions(cacheDir, platform = process.platform) {
  if (platform === 'win32') return;

  function visit(target) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      fs.chmodSync(target, 0o755);
      for (const entry of fs.readdirSync(target)) {
        visit(path.join(target, entry));
      }
      return;
    }
    fs.chmodSync(target, 0o755);
  }

  visit(cacheDir);
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

async function checkCamoufoxHealth({
  platform = process.platform,
  homedir = os.homedir(),
} = {}) {
  // Auto-repair is only defined for the cache root Camo installs into.
  // An explicit executable path is caller-managed, so a missing or stale
  // install there is reported, never overwritten.
  const explicitExecutable = explicitCamoufoxExecutable();
  const repairable = explicitExecutable === '';
  const cacheDir = resolveCamoufoxCacheDir({ platform, homedir });
  const installPaths = camoufoxInstallPaths({ platform, cacheDir });
  const {
    executablePath,
    macosPropertiesPath,
    propertiesPath,
    versionPath,
  } = installPaths;

  if (!fs.existsSync(propertiesPath)) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_BINARY_MISSING',
      repairable,
      error: repairable
        ? 'Camoufox binary not found. Run: npx camoufox fetch'
        : `Camoufox binary not found at the explicit CAMO_EXECUTABLE_PATH installation: ${cacheDir}`,
    };
  }

  if (!fs.existsSync(executablePath)) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_BINARY_MISSING',
      repairable,
      error: `Camoufox executable not found: ${executablePath}`,
    };
  }

  if (!fs.existsSync(versionPath)) {
    return {
      ok: false,
      launchVerified: false,
      launchOwner: 'daemon.browser_service',
      errorCode: 'E_CAMOUFOX_VERSION_MISSING',
      repairable,
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

  // Camoufox's npm launcher reads properties.json next to the macOS
  // executable even though the release stores it in Resources.
  if (
    platform === 'darwin'
    && !fs.existsSync(macosPropertiesPath)
  ) {
    try {
      fs.symlinkSync(propertiesPath, macosPropertiesPath);
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
    cacheDir,
    installPath: propertiesPath,
    versionPath,
    camoufoxVersion: installedVersion.version,
    camoufoxRelease: installedVersion.release,
    playwrightCoreVersion,
  };
}

/**
 * Ensure Camoufox installation is ready. Auto-fetches if missing.
 */
async function ensureCamoufox({
  fetchImpl = globalThis.fetch,
  platform = process.platform,
  homedir = os.homedir(),
} = {}) {
  const health = await checkCamoufoxHealth({ platform, homedir });
  if (health.ok) return health;

  if (!health.repairable) {
    throw new Error('Camoufox unhealthy: ' + health.error);
  }

  console.error('Camoufox runtime is missing or incompatible, fetching the admitted binary...');
  const cacheDir = camoufoxCacheDir({ platform, homedir });
  // Stage beside the cache root. The install replaces cacheDir below, so a
  // staging directory nested inside it would be deleted before extraction.
  const downloadDir = path.join(
    path.dirname(cacheDir),
    `.camoufox-download-${process.pid}-${Date.now()}`,
  );
  const archivePath = path.join(downloadDir, 'camoufox.zip');

  fs.mkdirSync(downloadDir, { recursive: true });
  try {
    const response = await fetchImpl(camoufoxArchiveUrl({ platform }));
    if (!response?.ok || !response.body) {
      throw new Error(`Camoufox archive download failed with status ${response?.status ?? 'unknown'}`);
    }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(archivePath));
    new AdmZip(archivePath).extractAllTo(downloadDir, true);

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
    setCamoufoxPermissions(cacheDir, platform);
  } finally {
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }

  const retry = await checkCamoufoxHealth({ platform, homedir });
  if (!retry.ok) {
    throw new Error('Camoufox setup failed: ' + retry.error);
  }
  return retry;
}

export {
  CAMOUFOX_RUNTIME_CONTRACT,
  camoufoxCacheDir,
  camoufoxInstallPaths,
  checkCamoufoxHealth,
  ensureCamoufox,
  setCamoufoxPermissions,
  validateCamoufoxRuntimeVersions,
};
