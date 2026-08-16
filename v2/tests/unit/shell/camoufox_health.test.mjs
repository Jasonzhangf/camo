// camoufox_health truth contract:
//   - Reports installation readiness only, never claims the browser was launched.
//   - launchVerified: false is a hard contract field.
//   - Missing install surfaces install-not-found with ok:false.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function loadFresh() {
  const url = new URL('../../../shell/camoufox_health.mjs', import.meta.url).href + `?t=${Date.now()}-${Math.random()}`;
  return import(url);
}

function withFakeInstall(makeFake) {
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
