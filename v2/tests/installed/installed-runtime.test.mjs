import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(new URL('../../../', import.meta.url).pathname);
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
function run(cmd, args, opts = {}) {
  const out = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return out;
}

function expectOk(out, label) {
  assert.equal(out.status, 0, `${label} failed\nstdout=${out.stdout}\nstderr=${out.stderr}`);
}

function readJson(out, label) {
  expectOk(out, label);
  return JSON.parse(out.stdout);
}

function registrationsFor(home) {
  const file = path.join(home, '.camo', 'daemon', '.shared-daemon.claim');
  if (!fs.existsSync(file)) return [];
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw.state === 'active' ? [raw] : [];
}

test('installed package: pack, global install, version, ephemeral cleanup', { timeout: 180_000 }, (t) => {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-pack-'));
  const installPrefix = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-prefix-'));
  const runtimeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-installed-home-'));
  let callerDir = null;
  let installedCamoBin = null;
  const installedProfile = `installed-start-${process.pid}`;
  const runtimeEnv = {
    HOME: runtimeHome,
    CAMO_AUTOSTART: '1',
    CAMO_HEADLESS: '1',
  };
  t.after(() => {
    if (installedCamoBin) {
      run(installedCamoBin, ['daemon', 'stop', '--profile', installedProfile], { env: runtimeEnv });
    }
    if (callerDir) fs.rmSync(callerDir, { recursive: true, force: true });
    fs.rmSync(packDir, { recursive: true, force: true });
    fs.rmSync(installPrefix, { recursive: true, force: true });
    fs.rmSync(runtimeHome, { recursive: true, force: true });
  });
  const pack = run(NPM, ['pack', '--pack-destination', packDir]);
  expectOk(pack, 'npm pack');
  const tarball = path.join(packDir, pack.stdout.trim().split(/\r?\n/).pop());
  assert.equal(fs.existsSync(tarball), true, 'packed tarball must exist');

  expectOk(run(NPM, ['install', '-g', '--prefix', installPrefix, tarball]), 'npm install packed tarball under temporary prefix');
  const camoBin = process.platform === 'win32'
    ? path.join(installPrefix, 'camo.cmd')
    : path.join(installPrefix, 'bin', 'camo');
  installedCamoBin = camoBin;
  assert.equal(fs.existsSync(camoBin), true, 'temporary prefix must contain the packed camo binary');
  expectOk(run(camoBin, ['--version'], { env: { HOME: runtimeHome, CAMO_AUTOSTART: '0' } }), 'installed camo --version');

  const started = readJson(run(camoBin, ['start', '--profile', installedProfile, '--url', 'https://example.com'], {
    env: runtimeEnv,
  }), 'installed persistent start with URL');
  assert.equal(started.profile, installedProfile);
  const startedPage = readJson(run(camoBin, ['get-page-info', '--profile', installedProfile], {
    env: runtimeEnv,
  }), 'installed start URL page info');
  assert.equal(startedPage.url, 'https://example.com/');
  assert.equal(startedPage.title, 'Example Domain');
  expectOk(run(camoBin, ['stop', '--profile', installedProfile], { env: runtimeEnv }), 'installed profile stop');
  expectOk(run(camoBin, ['daemon', 'stop', '--profile', installedProfile], { env: runtimeEnv }), 'installed daemon stop');

  callerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-installed-cwd-'));
  const relativePath = `camo-installed-${process.pid}-${Date.now()}.png`;
  const screenshotPath = path.join(fs.realpathSync(callerDir), relativePath);
  const snap = readJson(run(camoBin, ['screenshot', '--path', relativePath], {
    cwd: callerDir,
    env: runtimeEnv,
  }), 'installed ephemeral screenshot');
  assert.match(snap.profile, /^_ephemeral_/, 'installed single command must use an ephemeral profile');
  assert.equal(snap.saved, true, 'installed screenshot must report saved=true');
  assert.equal(snap.path, screenshotPath, 'installed screenshot path must be canonical absolute path');
  assert.ok(fs.statSync(screenshotPath).size > 0, 'installed screenshot file must be non-empty');
  fs.unlinkSync(screenshotPath);
  assert.deepEqual(registrationsFor(runtimeHome), [], 'ephemeral daemon registration must be removed by daemon owner');
  assert.equal(fs.existsSync(path.join(runtimeHome, '.camo', 'profiles', snap.profile)), false, 'ephemeral profile must be deleted');
  assert.equal(fs.existsSync(path.join(runtimeHome, '.camo', 'locks', `${snap.profile}.lock.json`)), false, 'ephemeral lock must be released');

});
