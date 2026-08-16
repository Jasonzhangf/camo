// CookieStore unit tests.
// Covers: Netscape round-trip, session cookies, import merge, profile isolation,
// cleanup/clear, and XHSSearch/BrowserInstance domain normalization consistency.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CookieStore, getCookieStore } from '../../../services/profile/cookie_store.mjs';

// 每次测试独立临时目录，避免污染真实 ~/.camo
function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-cookiestore-'));
  return { dir, store: new CookieStore({ storageDir: dir }) };
}

test.after(() => {
  // 清理测试产生的临时目录（getCookieStore 的 profile 目录用测试 HOME 隔离）
  for (const d of fs.readdirSync(os.tmpdir())) {
    if (d.startsWith('camo-cookiestore-')) {
      fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
    }
  }
});

test('roundtrip: save -> load preserves cookie fields', () => {
  const { store } = makeStore();
  const cookies = [
    { name: 'a', value: '1', domain: '.example.com', path: '/', secure: false, httpOnly: true, expires: 1786026438 },
    { name: 'b', value: '2', domain: 'example.com', path: '/', secure: true, expires: undefined },
  ];
  store.saveCookies('example.com', cookies);
  const loaded = store.loadCookies('example.com');
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].name, 'a');
  assert.equal(loaded[0].domain, '.example.com');
  assert.equal(loaded[0].expires, 1786026438);
  assert.equal(loaded[1].name, 'b');
  assert.equal(loaded[1].expires, undefined, 'session cookie has no expires');
});

test('roundtrip: session cookie (expires=-1) survives round trip', () => {
  const { store } = makeStore();
  store.saveCookies('sess.com', [{ name: 's', value: 'v', domain: '.sess.com', path: '/', expires: -1 }]);
  const loaded = store.loadCookies('sess.com');
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].name, 's');
  assert.equal(loaded[0].expires, undefined, '-1 (session) maps to undefined after parse');
});

test('netscape: export produces valid 7-field lines, import round-trips', () => {
  const { store } = makeStore();
  const cookies = [
    { name: 'a', value: '1', domain: '.example.com', path: '/', secure: false, expires: 1786026438 },
    { name: 'b', value: '2', domain: 'example.com', path: '/', secure: true, expires: -1 },
  ];
  const text = store.exportNetscapeFormat(cookies);
  const lines = text.split('\n').filter(l => l && !l.startsWith('#'));
  assert.equal(lines.length, 2, 'two cookie lines');
  for (const line of lines) {
    assert.equal(line.split('\t').length, 7, 'Netscape line has 7 tab-separated fields');
  }
  // importNetscape 后能读回
  const imported = store.importNetscape(text);
  assert.equal(imported, 2);
  const reloaded = store.loadCookies('example.com');
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].domain, '.example.com');
});

test('import: merges with existing cookies by name instead of overwriting', () => {
  const { store } = makeStore();
  store.saveCookies('example.com', [
    { name: 'keep', value: 'old', domain: '.example.com', path: '/', expires: 1786026438 },
  ]);
  const imported = store.importNetscape(
    '# Netscape HTTP Cookie File\n' +
    '.example.com\tTRUE\t/\tFALSE\t1786026438\tkeep\tnew\n' +
    'example.com\tFALSE\t/\tTRUE\t1786026438\tfresh\tadded\n'
  );
  assert.equal(imported, 2);
  const loaded = store.loadCookies('example.com');
  const byName = Object.fromEntries(loaded.map(c => [c.name, c]));
  assert.equal(byName.keep.value, 'new', 'existing cookie updated in place');
  assert.equal(byName.fresh.value, 'added', 'new cookie merged in');
});

test('import: keeps same-name cookies with different path (domain+path+name key)', () => {
  const { store } = makeStore();
  const imported = store.importNetscape(
    '# Netscape HTTP Cookie File\n' +
    '.example.com\tTRUE\t/\tFALSE\t1786026438\tdup\troot\n' +
    '.example.com\tTRUE\t/app\tFALSE\t1786026438\tdup\tapp\n'
  );
  assert.equal(imported, 2);
  const loaded = store.loadCookies('example.com');
  assert.equal(loaded.length, 2, 'same name + different path must both survive');
  const byPath = Object.fromEntries(loaded.map(c => [c.path || '/', c.value]));
  assert.equal(byPath['/'], 'root');
  assert.equal(byPath['/app'], 'app');
});

test('profile isolation: getCookieStore(profile) uses per-profile storage dir', () => {
  // 用临时 HOME 隔离，验证不同 profile 目录不同
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-cookie-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    const a = getCookieStore('profile-a');
    const b = getCookieStore('profile-b');
    assert.notEqual(a.config.storageDir, b.config.storageDir, 'profiles must use different dirs');
    assert.ok(a.config.storageDir.endsWith(path.join('.camo', 'profiles', 'profile-a', 'cookie-backups')));
    assert.ok(b.config.storageDir.endsWith(path.join('.camo', 'profiles', 'profile-b', 'cookie-backups')));

    // profile-a 保存的 cookie 不应出现在 profile-b
    a.saveCookies('example.com', [{ name: 'x', value: '1', domain: '.example.com', path: '/', expires: 1786026438 }]);
    assert.equal(b.loadCookies('example.com').length, 0, 'no cross-profile leakage');
    assert.equal(a.loadCookies('example.com').length, 1);
  } finally {
    process.env.HOME = prevHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('portable root: profile cookie backups stay under the configured profile root', () => {
  const portableProfiles = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-cookie-portable-'));
  const previous = process.env.CAMO_PATHS_PROFILES;
  process.env.CAMO_PATHS_PROFILES = portableProfiles;
  try {
    const store = getCookieStore('portable-profile');
    assert.equal(
      store.config.storageDir,
      path.join(portableProfiles, 'portable-profile', 'cookie-backups'),
    );
    store.saveCookies('example.com', [{ name: 'portable', value: '1', domain: '.example.com', path: '/' }]);
    assert.equal(fs.existsSync(path.join(store.config.storageDir, 'example.com.txt')), true);
  } finally {
    if (previous === undefined) delete process.env.CAMO_PATHS_PROFILES;
    else process.env.CAMO_PATHS_PROFILES = previous;
    fs.rmSync(portableProfiles, { recursive: true, force: true });
  }
});

test('negative: clearing cookie backups preserves profile-owned runtime files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-cookie-preserve-'));
  const backupDir = path.join(root, 'cookie-backups');
  const store = new CookieStore({ storageDir: backupDir });
  fs.writeFileSync(path.join(root, 'cookies.sqlite'), 'browser cookies', 'utf8');
  fs.writeFileSync(path.join(root, 'fingerprint.json'), '{}', 'utf8');
  store.saveCookies('example.com', [{ name: 'backup', value: '1', domain: '.example.com', path: '/' }]);

  store.clearAll();

  assert.equal(fs.readFileSync(path.join(root, 'cookies.sqlite'), 'utf8'), 'browser cookies');
  assert.equal(fs.existsSync(path.join(root, 'fingerprint.json')), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('cleanupExpiredDomains removes stale domain files', () => {
  const { dir, store } = makeStore();
  store.saveCookies('fresh.com', [{ name: 'f', value: '1', domain: '.fresh.com', path: '/', expires: 1786026438 }]);
  store.saveCookies('stale.com', [{ name: 's', value: '1', domain: '.stale.com', path: '/', expires: 1786026438 }]);
  // stale.com 无 visitMap 记录 -> lastVisit=0 -> 视为过期
  store.cleanupExpiredDomains();
  const remaining = store.getBackupDomains();
  assert.ok(!remaining.includes('stale.com'), 'stale domain file removed');
  assert.ok(!fs.existsSync(path.join(dir, 'stale.com.txt')));
});

test('clearAll removes all cookie files but keeps visit map file', () => {
  const { dir, store } = makeStore();
  store.saveCookies('a.com', [{ name: 'a', value: '1', domain: '.a.com', path: '/', expires: 1786026438 }]);
  store.saveCookies('b.com', [{ name: 'b', value: '1', domain: '.b.com', path: '/', expires: 1786026438 }]);
  store.clearAll();
  assert.equal(store.getBackupDomains().length, 0);
  assert.equal(fs.existsSync(path.join(dir, '.lastVisit.json')), true, 'visit map file kept');
});

test('registrableDomain: strips leading dot and keeps last two labels', () => {
  const { store } = makeStore();
  assert.equal(store.registrableDomain('.xiaohongshu.com'), 'xiaohongshu.com');
  assert.equal(store.registrableDomain('www.xiaohongshu.com'), 'xiaohongshu.com');
  assert.equal(store.registrableDomain('edith.xiaohongshu.com'), 'xiaohongshu.com');
  assert.equal(store.registrableDomain('example.com'), 'example.com');
});
