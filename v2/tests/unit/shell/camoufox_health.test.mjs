// camoufox_health truth contract:
//   - Reports installation readiness only, never claims the browser was launched.
//   - launchVerified: false is a hard contract field.
//   - Missing install surfaces install-not-found with ok:false.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

function loadFresh() {
  const url = new URL('../../../shell/camoufox_health.mjs', import.meta.url).href + `?t=${Date.now()}-${Math.random()}`;
  return import(url);
}

function withFakeInstall(makeFake, versionManifest = {
  version: '152.0.4',
  release: 'beta.29',
}) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-health-'));
  const previousHome = process.env.HOME;
  process.env.HOME = tmpHome;
  const cacheDir = process.platform === 'darwin'
    ? path.join(tmpHome, 'Library', 'Caches', 'camoufox')
    : path.join(tmpHome, '.cache', 'camoufox');
  let installed = false;
  const teardown = () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  };
  if (makeFake) {
    const propsDir = path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources');
    const macosDir = path.join(cacheDir, 'Camoufox.app', 'Contents', 'MacOS');
    fs.mkdirSync(propsDir, { recursive: true });
    fs.mkdirSync(macosDir, { recursive: true });
    fs.writeFileSync(path.join(propsDir, 'properties.json'), '{"fake":true}', 'utf8');
    if (versionManifest !== null) {
      const body = typeof versionManifest === 'string'
        ? versionManifest
        : JSON.stringify(versionManifest);
      fs.writeFileSync(path.join(cacheDir, 'version.json'), body, 'utf8');
    }
    installed = true;
  }
  return { teardown, installed };
}

test('negative: missing Camoufox install surfaces an install-not-found result', async () => {
  const { teardown } = withFakeInstall(false);
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth();
    assert.equal(out.ok, false);
    assert.match(out.error || '', /not found|Run: npx camoufox fetch/);
    assert.equal(out.launchVerified, false, 'missing install must not claim launch verification');
    assert.equal(out.launchOwner, 'daemon.browser_service');
  } finally { teardown(); }
});

test('positive: present Camoufox install reports installation readiness and never claims launch verification', async () => {
  const { teardown } = withFakeInstall(true);
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth();
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

  const previousHome = process.env.HOME;
  const previousExe = process.env.CAMO_EXECUTABLE_PATH;
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-health-empty-home-'));
  process.env.HOME = isolatedHome;
  process.env.CAMO_EXECUTABLE_PATH = exePath;
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth();
    assert.equal(out.ok, true);
    assert.equal(out.installPath, path.join(propsDir, 'properties.json'));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousExe === undefined) delete process.env.CAMO_EXECUTABLE_PATH;
    else process.env.CAMO_EXECUTABLE_PATH = previousExe;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
});

test('negative: Camoufox beta.28 is rejected because it can deadlock mouse acknowledgements', async () => {
  const { teardown } = withFakeInstall(true, {
    version: '152.0.4',
    release: 'beta.28',
  });
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth();
    assert.equal(out.ok, false);
    assert.equal(out.errorCode, 'E_CAMOUFOX_BINARY_INCOMPATIBLE');
    assert.match(out.error || '', /beta\.28|beta\.29/);
  } finally { teardown(); }
});

test('negative: missing Camoufox version manifest is rejected explicitly', async () => {
  const { teardown } = withFakeInstall(true, null);
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth();
    assert.equal(out.ok, false);
    assert.equal(out.errorCode, 'E_CAMOUFOX_VERSION_MISSING');
  } finally { teardown(); }
});

test('negative: malformed Camoufox version manifest is rejected explicitly', async () => {
  const { teardown } = withFakeInstall(true, '{not-json');
  try {
    const mod = await loadFresh();
    const out = await mod.checkCamoufoxHealth();
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
  const commands = [];
  const fakeSpawn = (command, args) => {
    commands.push({ command, args });
    const child = new EventEmitter();
    setImmediate(() => {
      if (command === 'curl') {
        const out = args[args.indexOf('-o') + 1];
        fs.writeFileSync(out, 'fake archive');
      } else if (command === 'unzip') {
        const dest = args[args.indexOf('-d') + 1];
        const resources = path.join(dest, 'Camoufox.app', 'Contents', 'Resources');
        fs.mkdirSync(resources, { recursive: true });
        fs.mkdirSync(path.join(dest, 'Camoufox.app', 'Contents', 'MacOS'), { recursive: true });
        fs.writeFileSync(path.join(resources, 'properties.json'), '{"fake":true}');
      }
      child.emit('close', 0);
    });
    return child;
  };

  const previousHome = process.env.HOME;
  process.env.HOME = homeDir;
  try {
    const mod = await loadFresh();
    const out = await mod.ensureCamoufox({ spawnImpl: fakeSpawn });
    assert.equal(out.ok, true);
    const cacheDir = process.platform === 'darwin'
      ? path.join(homeDir, 'Library', 'Caches', 'camoufox')
      : process.platform === 'win32'
        ? path.join(homeDir, 'AppData', 'Local', 'camoufox')
        : path.join(homeDir, '.cache', 'camoufox');
    assert.equal(
      out.installPath,
      path.join(cacheDir, 'Camoufox.app', 'Contents', 'Resources', 'properties.json'),
    );
    assert.equal(fs.existsSync(path.join(cacheDir, 'version.json')), true);
    assert.equal(
      fs.readdirSync(path.dirname(cacheDir)).some((entry) => entry.startsWith('.camoufox-download-')),
      false,
    );
    assert.deepEqual(commands.map((entry) => entry.command), ['curl', 'unzip']);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
