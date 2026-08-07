// Cookie Store - ITP 防护、Netscape 格式
// Profile 隔离：每个 profile 一个独立存储目录（~/.camo/cookies/<profile>/）

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DEFAULT_CONFIG = {
  syncInterval: 60 * 1000,
  domainRetention: 30 * 24 * 3600 * 1000,
  maxDomains: 1000,
  storageDir: path.join(os.homedir(), '.camo', 'cookies'),
};

export class CookieStore {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.lastSyncAt = 0;
    this.syncing = false;
    this.visitMap = new Map();
    this.ensureStorageDir();
    this.loadVisitMap();
  }
  
  ensureStorageDir() {
    if (!fs.existsSync(this.config.storageDir)) {
      fs.mkdirSync(this.config.storageDir, { recursive: true });
    }
  }
  
  getCookieFile(domain) { return path.join(this.config.storageDir, `${domain}.txt`); }
  getVisitMapFile() { return path.join(this.config.storageDir, '.lastVisit.json'); }
  
  registrableDomain(domain) {
    const bare = domain.startsWith('.') ? domain.slice(1) : domain;
    const parts = bare.split('.');
    if (parts.length <= 2) return bare;
    return parts.slice(-2).join('.');
  }
  
  noteVisit(url) {
    try {
      const host = new URL(url).hostname;
      const domain = this.registrableDomain(host);
      this.visitMap.set(domain, Date.now());
      this.persistVisitMap();
    } catch {}
  }
  
  loadVisitMap() {
    try {
      const file = this.getVisitMapFile();
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.visitMap = new Map(Object.entries(data));
      }
    } catch {}
  }
  
  persistVisitMap() {
    try {
      const data = Object.fromEntries(this.visitMap);
      fs.writeFileSync(this.getVisitMapFile(), JSON.stringify(data, null, 2));
    } catch {}
  }
  
  exportNetscapeFormat(cookies) {
    const lines = ['# Netscape HTTP Cookie File', '# Written by Camo CookieStore', ''];
    for (const c of cookies.sort((a, b) => (a.domain || '').localeCompare(b.domain || ''))) {
      const domain = c.domain || '';
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.expires ? String(Math.floor(c.expires)) : '0';
      lines.push([domain, includeSubdomains, c.path || '/', secure, expiry, c.name, c.value].join('\t'));
    }
    return lines.join('\n') + '\n';
  }
  
  parseNetscapeFormat(text) {
    const cookies = [];
    for (const rawLine of text.split('\n')) {
      let line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const fields = line.split('\t');
      if (fields.length !== 7) continue;
      const expiry = parseInt(fields[4], 10);
      cookies.push({ name: fields[5], value: fields[6], domain: fields[0], path: fields[2], secure: fields[3] === 'TRUE', expires: expiry > 0 ? expiry : undefined });
    }
    return cookies;
  }
  
  saveCookies(domain, cookies) {
    const file = this.getCookieFile(domain);
    const text = this.exportNetscapeFormat(cookies);
    try {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (existing !== text) fs.writeFileSync(file, text, 'utf8');
    } catch (err) { console.error(`Failed to save cookies for ${domain}:`, err); }
  }
  
  loadCookies(domain) {
    const file = this.getCookieFile(domain);
    try { if (fs.existsSync(file)) return this.parseNetscapeFormat(fs.readFileSync(file, 'utf8')); }
    catch {}
    return [];
  }
  
  getBackupDomains() {
    try {
      return fs.readdirSync(this.config.storageDir)
        .filter(f => f.endsWith('.txt') && !f.startsWith('.'))
        .map(f => f.replace('.txt', ''));
    } catch {}
    return [];
  }
  
  // 清理过期/超限的 domain cookie 备份（与 CookieStore.ts 保持同步）
  cleanupExpiredDomains() {
    const now = Date.now();
    const domains = this.getBackupDomains();
    
    for (const domain of domains) {
      const lastVisit = this.visitMap.get(domain) || 0;
      const expired = now - lastVisit > this.config.domainRetention;
      const overCap = this.visitMap.size > this.config.maxDomains;
      
      if (expired || overCap) {
        try {
          fs.unlinkSync(this.getCookieFile(domain));
          this.visitMap.delete(domain);
        } catch {}
      }
    }
    
    this.persistVisitMap();
  }
  
  // 清空所有 cookie 备份（与 CookieStore.ts 保持同步）
  clearAll() {
    try {
      const files = fs.readdirSync(this.config.storageDir);
      for (const file of files) {
        if (!file.startsWith('.')) {
          fs.unlinkSync(path.join(this.config.storageDir, file));
        }
      }
      this.visitMap.clear();
      this.persistVisitMap();
    } catch {}
  }
  
  importNetscape(text) {
    const cookies = this.parseNetscapeFormat(text);
    const byDomain = new Map();
    for (const cookie of cookies) {
      const domain = this.registrableDomain(cookie.domain || '');
      if (!byDomain.has(domain)) byDomain.set(domain, []);
      byDomain.get(domain).push(cookie);
    }
    let imported = 0;
    for (const [domain, domainCookies] of byDomain) {
      // 与已有 cookie 合并（按 domain+path+name 去重，Netscape 唯一键）
      const existing = this.loadCookies(domain);
      const key = c => `${c.domain}|${c.path || '/'}|${c.name}`;
      const merged = new Map(existing.map(c => [key(c), c]));
      for (const c of domainCookies) merged.set(key(c), c);
      this.saveCookies(domain, [...merged.values()]);
      imported += domainCookies.length;
    }
    return imported;
  }
  
  getBackupSummary() {
    const domains = this.getBackupDomains();
    let cookieCount = 0;
    for (const domain of domains) cookieCount += this.loadCookies(domain).length;
    return { domainCount: domains.length, cookieCount, domains };
  }
}

let globalCookieStore = null;
const profileStores = new Map();

/**
 * 获取 CookieStore 实例。
 * @param {string} [profile] - profile 名；传入时使用 profile 隔离的存储目录
 *   （~/.camo/cookies/<profile>/），与 BrowserInstance 的 cookie 目录保持一致。
 *   不传时返回全局共享实例（向后兼容）。
 */
export function getCookieStore(profile) {
  const pid = String(profile || '').trim();
  if (!pid) {
    if (!globalCookieStore) globalCookieStore = new CookieStore();
    return globalCookieStore;
  }
  // 与 BrowserInstance 一致的 profile 白名单校验：拒绝路径穿越/绝对路径
  if (!/^[a-zA-Z0-9_-]+$/.test(pid)) {
    throw new Error(`E_INVALID_PROFILE: profile must match ^[a-zA-Z0-9_-]+$, got "${pid}"`);
  }
  let store = profileStores.get(pid);
  if (!store) {
    store = new CookieStore({ storageDir: path.join(os.homedir(), '.camo', 'cookies', pid) });
    profileStores.set(pid, store);
  }
  return store;
}
