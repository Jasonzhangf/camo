// Cookie Store - ITP 防护、跨会话持久化、Profile 隔离

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CookieEntry } from './Actions.js';

export interface CookieBackupConfig {
  syncInterval: number;
  domainRetention: number;
  maxDomains: number;
  storageDir: string;
}

const DEFAULT_CONFIG: CookieBackupConfig = {
  syncInterval: 60 * 1000,
  domainRetention: 30 * 24 * 3600 * 1000,
  maxDomains: 1000,
  storageDir: path.join(os.homedir(), '.camo', 'cookies'),
};

export class CookieStore {
  config: CookieBackupConfig;
  private lastSyncAt = 0;
  private syncing = false;
  private visitMap: Map<string, number> = new Map();

  constructor(config: Partial<CookieBackupConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureStorageDir();
    this.loadVisitMap();
  }

  private ensureStorageDir(): void {
    if (!fs.existsSync(this.config.storageDir)) {
      fs.mkdirSync(this.config.storageDir, { recursive: true });
    }
  }

  private getCookieFile(domain: string): string {
    return path.join(this.config.storageDir, `${domain}.txt`);
  }

  private getVisitMapFile(): string {
    return path.join(this.config.storageDir, '.lastVisit.json');
  }

  registrableDomain(domain: string): string {
    const bare = domain.startsWith('.') ? domain.slice(1) : domain;
    const parts = bare.split('.');
    if (parts.length <= 2) return bare;
    return parts.slice(-2).join('.');
  }

  noteVisit(url: string): void {
    try {
      const host = new URL(url).hostname;
      const domain = this.registrableDomain(host);
      this.visitMap.set(domain, Date.now());
      this.persistVisitMap();
    } catch {}
  }

  private loadVisitMap(): void {
    try {
      const file = this.getVisitMapFile();
      if (fs.existsSync(file)) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        this.visitMap = new Map(Object.entries(data as Record<string, number>));
      }
    } catch {}
  }

  private persistVisitMap(): void {
    try {
      const data = Object.fromEntries(this.visitMap);
      fs.writeFileSync(this.getVisitMapFile(), JSON.stringify(data, null, 2));
    } catch {}
  }

  exportNetscapeFormat(cookies: CookieEntry[]): string {
    const lines = [
      '# Netscape HTTP Cookie File',
      '# Written by Camo CookieStore',
      '',
    ];
    
    for (const c of cookies.sort((a, b) => (a.domain || '').localeCompare(b.domain || ''))) {
      const domain = c.domain || '';
      const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
      const secure = c.secure ? 'TRUE' : 'FALSE';
      const expiry = c.expires ? String(Math.floor(c.expires)) : '0';
      lines.push([domain, includeSubdomains, c.path || '/', secure, expiry, c.name, c.value].join('\t'));
    }
    
    return lines.join('\n') + '\n';
  }

  parseNetscapeFormat(text: string): CookieEntry[] {
    const cookies: CookieEntry[] = [];
    
    for (const rawLine of text.split('\n')) {
      let line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      
      const fields = line.split('\t');
      if (fields.length !== 7) continue;
      
      const expiry = parseInt(fields[4], 10);
      cookies.push({
        name: fields[5],
        value: fields[6],
        domain: fields[0],
        path: fields[2],
        secure: fields[3] === 'TRUE',
        expires: expiry > 0 ? expiry : undefined,
      });
    }
    
    return cookies;
  }

  saveCookies(domain: string, cookies: CookieEntry[]): void {
    const file = this.getCookieFile(domain);
    const text = this.exportNetscapeFormat(cookies);
    
    try {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (existing !== text) {
        fs.writeFileSync(file, text, 'utf8');
      }
    } catch (err) {
      console.error(`Failed to save cookies for ${domain}:`, err);
    }
  }

  loadCookies(domain: string): CookieEntry[] {
    const file = this.getCookieFile(domain);
    try {
      if (fs.existsSync(file)) {
        return this.parseNetscapeFormat(fs.readFileSync(file, 'utf8'));
      }
    } catch {}
    return [];
  }

  getBackupDomains(): string[] {
    try {
      const files = fs.readdirSync(this.config.storageDir);
      return files.filter((f: string) => f.endsWith('.txt') && !f.startsWith('.')).map((f: string) => f.replace('.txt', ''));
    } catch {}
    return [];
  }

  cleanupExpiredDomains(): void {
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

  getBackupSummary(): { domainCount: number; cookieCount: number; domains: string[] } {
    const domains = this.getBackupDomains();
    let cookieCount = 0;
    
    for (const domain of domains) {
      cookieCount += this.loadCookies(domain).length;
    }
    
    return { domainCount: domains.length, cookieCount, domains };
  }

  clearAll(): void {
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

  importNetscape(text: string): number {
    const cookies = this.parseNetscapeFormat(text);
    const byDomain = new Map<string, CookieEntry[]>();
    
    for (const cookie of cookies) {
      const domain = this.registrableDomain(cookie.domain || '');
      if (!byDomain.has(domain)) {
        byDomain.set(domain, []);
      }
      byDomain.get(domain)!.push(cookie);
    }
    
    let imported = 0;
    for (const [domain, domainCookies] of byDomain) {
      this.saveCookies(domain, domainCookies);
      imported += domainCookies.length;
    }
    
    return imported;
  }
}

let globalCookieStore: CookieStore | null = null;

export function getCookieStore(): CookieStore {
  if (!globalCookieStore) {
    globalCookieStore = new CookieStore();
  }
  return globalCookieStore;
}
