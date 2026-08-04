// Cookie Store - ITP 防护、Netscape 格式

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
      this.saveCookies(domain, domainCookies);
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
export function getCookieStore() {
  if (!globalCookieStore) globalCookieStore = new CookieStore();
  return globalCookieStore;
}
