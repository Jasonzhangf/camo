// camoufox_health truth contract:
//   - Reports installation readiness only, never claims the browser was launched.
//   - launchVerified: false is a hard contract field.
//   - Missing install surfaces install-not-found with ok:false.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';

function loadFresh() {
  const url = new URL('../../../shell/camoufox_health.mjs', import.meta.url).href + `?t=${Date.now()}-${Math.random()}`;
  return import(url);
}

function withFakeInstall(makeFake, versionManifest = {
  version: '152.0.4',
  release: 'beta.29',
}, platform = process.platform) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-health-'));
  const cacheDir = platform === 'win32'
    ? path.join(tmpHome, 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache')
    : platform === 'darwin'
      ? path.join(tmpHome, 'Library', 'Caches', 'camoufox')
      : path.join(tmpHome, '.cache', 'camoufox');
  const teardown = () => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  };
  if (makeFake) {
    const propsDir = platform === 'darwin'
      ? path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources')
      : cacheDir;
    const macosDir = platform === 'darwin'
      ? path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS')
      : cacheDir;
    fs.mkdirSync(propsDir, { recursive: true });
    fs.mkdirSync(macosDir, { recursive: true });
    fs.writeFileSync(path.join(propsDir, 'properties.json'), '{"fake":true}', 'utf8');
    fs.writeFileSync(
      path.join(
        macosDir,
        platform === 'win32'
          ? 'camoufox.exe'
          : platform === 'darwin'
            ? 'camoufox'
            : 'camoufox-bin',
      ),
      '',
      'utf8',
    );
    if (versionManifest !== null) {
      const body = typeof versionManifest === 'string'
        ? versionManifest
        : JSON.stringify(versionManifest);
      fs.writeFileSync(path.join(cacheDir, 'version.json'), body, 'utf8');
    }
  }
  return { teardown, tmpHome };
}

test('negative: missing Camoufox install surfaces an install-not-found result', async () => {
  const { teardown, tmpHome } = withFakeInstall(false);
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth({ homedir: tmpHome });
    assert.equal(out.ok, false);
    assert.match(out.error || '', /not found|Run: npx camoufox fetch/);
    assert.equal(out.launchVerified, false, 'missing install must not claim launch verification');
    assert.equal(out.launchOwner, 'daemon.browser_service');
  } finally { teardown(); }
});

test('positive: present Camoufox install reports installation readiness and never claims launch verification', async () => {
  const { teardown, tmpHome } = withFakeInstall(true);
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth({ homedir: tmpHome });
    assert.equal(out.ok, true);
    assert.equal(out.launchVerified, false, 'install presence check must never promise launch success');
    assert.equal(out.launchOwner, 'daemon.browser_service', 'launch verification must remain owned by daemon browser-service');
  } finally { teardown(); }
});

test('positive: CAMO_EXECUTABLE_PATH resolves the installed binary under an isolated HOME', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-health-exe-'));
  const propsDir = path.join(tmpRoot, 'Camoufox.app', 'Contents', 'Resources');
  const macosDir = path.join(tmpRoot, 'Camoufox.app', 'Contents', 'MacOS');
  fs.mkdirSync(propsDir, { recursive: true });
  fs.mkdirSync(macosDir, { recursive: true });
  fs.writeFileSync(path.join(propsDir, 'properties.json'), '{"fake":true}', 'utf8');
  fs.writeFileSync(path.join(tmpRoot, 'version.json'), JSON.stringify({
    version: '152.0.4',
    release: 'beta.29',
  }), 'utf8');
  const exePath = path.join(macosDir, 'camoufox');
  fs.writeFileSync(exePath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const previousExe = process.env.CAMO_EXECUTABLE_PATH;
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-health-empty-home-'));
  process.env.CAMO_EXECUTABLE_PATH = exePath;
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth({ homedir: isolatedHome });
    assert.equal(out.ok, true);
    assert.equal(out.installPath, path.join(propsDir, 'properties.json'));
  } finally {
    if (previousExe === undefined) delete process.env.CAMO_EXECUTABLE_PATH;
    else process.env.CAMO_EXECUTABLE_PATH = previousExe;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test('negative: Camoufox beta.28 is rejected because it can deadlock mouse acknowledgements', async () => {
  const { teardown, tmpHome } = withFakeInstall(true, {
    version: '152.0.4',
    release: 'beta.28',
  });
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth({ homedir: tmpHome });
    assert.equal(out.ok, false);
    assert.equal(out.errorCode, 'E_CAMOUFOX_BINARY_INCOMPATIBLE');
    assert.match(out.error || '', /beta\.28|beta\.29/);
  } finally { teardown(); }
});

test('negative: missing Camoufox version manifest is rejected explicitly', async () => {
  const { teardown, tmpHome } = withFakeInstall(true, null);
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth({ homedir: tmpHome });
    assert.equal(out.ok, false);
    assert.equal(out.errorCode, 'E_CAMOUFOX_VERSION_MISSING');
  } finally { teardown(); }
});

test('negative: malformed Camoufox version manifest is rejected explicitly', async () => {
  const { teardown, tmpHome } = withFakeInstall(true, '{not-json');
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth({ homedir: tmpHome });
    assert.equal(out.ok, false);
    assert.equal(out.errorCode, 'E_CAMOUFOX_VERSION_INVALID');
  } finally { teardown(); }
});

test('negative: unverified Playwright 1.61 is rejected by the exact runtime contract', async () => {
  const mod = await loadFresh();
  const out = mod.validateCamoufoxRuntimeVersions({
    camoufoxVersion: '152.0.4',
    camoufoxRelease: 'beta.29',
    playwrightCoreVersion: '1.61.0',
  });
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'E_CAMOUFOX_PROTOCOL_INCOMPATIBLE');
});

test('negative: automatic repair downloads the exact admitted Camoufox release', async () => {
  const source = fs.readFileSync(
    new URL('../../../shell/camoufox_health.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /camoufox-\$\{camoufoxVersion\}-\$\{camoufoxRelease\}/);
  assert.doesNotMatch(source, /\['camoufox',\s*'fetch'\]/);
});

test('positive: automatic repair stages outside the cache root before replacing it', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-health-repair-'));
  const homeDir = path.join(tmpRoot, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  const archive = new AdmZip();
  archive.addFile('properties.json', Buffer.from('{"fake":true}'));
  archive.addFile('camoufox-bin', Buffer.from(''));
  const archiveBody = archive.toBuffer();
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return new Response(archiveBody, { status: 200 });
  };

  try {
    const mod = await loadFresh();
    const out = await mod.ensureCamoufox({
      fetchImpl,
      platform: 'linux',
      homedir: homeDir,
    });
    assert.equal(out.ok, true);
    const cacheDir = path.join(homeDir, '.cache', 'camoufox');
    assert.equal(
      out.installPath,
      path.join(cacheDir, 'properties.json'),
    );
    assert.equal(fs.existsSync(path.join(cacheDir, 'version.json')), true);
    assert.equal(
      fs.readdirSync(path.dirname(cacheDir)).some((entry) => entry.startsWith('.camoufox-download-')),
      false,
    );
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /camoufox-152\.0\.4-beta\.29-lin\./);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('positive: Windows uses the upstream nested cache layout', async () => {
  const mod = await loadFresh();
  const homedir = path.join(path.sep, 'Users', 'runner');
  const paths = mod.camoufoxInstallPaths({ platform: 'win32', homedir });

  assert.equal(
    paths.cacheDir,
    path.join(homedir, 'AppData', 'Local', 'camoufox', 'camoufox', 'Cache'),
  );
  assert.equal(paths.executablePath, path.join(paths.cacheDir, 'camoufox.exe'));
  assert.equal(paths.propertiesPath, path.join(paths.cacheDir, 'properties.json'));
});
