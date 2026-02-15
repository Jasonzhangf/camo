import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { CONFIG_DIR, ensureDir } from './config.mjs';

const GEOIP_DIR = path.join(CONFIG_DIR, 'geoip');
const GEOIP_MMDB = path.join(GEOIP_DIR, 'GeoLite2-City.mmdb');

// GeoIP regions mapping
export const GEOIP_REGIONS = {
  'us': { country: 'United States', timezone: 'America/New_York', locale: 'en-US', city: 'New York' },
  'us-west': { country: 'United States', timezone: 'America/Los_Angeles', locale: 'en-US', city: 'Los Angeles' },
  'uk': { country: 'United Kingdom', timezone: 'Europe/London', locale: 'en-GB', city: 'London' },
  'de': { country: 'Germany', timezone: 'Europe/Berlin', locale: 'de-DE', city: 'Berlin' },
  'fr': { country: 'France', timezone: 'Europe/Paris', locale: 'fr-FR', city: 'Paris' },
  'jp': { country: 'Japan', timezone: 'Asia/Tokyo', locale: 'ja-JP', city: 'Tokyo' },
  'sg': { country: 'Singapore', timezone: 'Asia/Singapore', locale: 'en-SG', city: 'Singapore' },
  'au': { country: 'Australia', timezone: 'Australia/Sydney', locale: 'en-AU', city: 'Sydney' },
  'br': { country: 'Brazil', timezone: 'America/Sao_Paulo', locale: 'pt-BR', city: 'Sao Paulo' },
  'in': { country: 'India', timezone: 'Asia/Kolkata', locale: 'en-IN', city: 'Mumbai' },
  'hk': { country: 'Hong Kong', timezone: 'Asia/Hong_Kong', locale: 'zh-HK', city: 'Hong Kong' },
  'tw': { country: 'Taiwan', timezone: 'Asia/Taipei', locale: 'zh-TW', city: 'Taipei' },
};

// OS options for fingerprint
export const OS_OPTIONS = {
  'mac': { platform: 'darwin', os: 'Macintosh', osVersion: '14.0', cpuCores: 8, memory: 16 },
  'mac-m1': { platform: 'darwin', os: 'Macintosh', osVersion: '14.0', cpuCores: 8, memory: 16, arch: 'arm64' },
  'mac-intel': { platform: 'darwin', os: 'Macintosh', osVersion: '14.0', cpuCores: 8, memory: 16, arch: 'x64' },
  'windows': { platform: 'win32', os: 'Windows', osVersion: '11', cpuCores: 8, memory: 16 },
  'windows-10': { platform: 'win32', os: 'Windows', osVersion: '10', cpuCores: 4, memory: 8 },
  'linux': { platform: 'linux', os: 'Linux', osVersion: 'Ubuntu 22.04', cpuCores: 4, memory: 8 },
};

export function hasGeoIP() {
  return fs.existsSync(GEOIP_MMDB);
}

export function getGeoIPPath() {
  return GEOIP_MMDB;
}

export async function downloadGeoIP(progressCb = console.log) {
  ensureDir(GEOIP_DIR);
  
  if (hasGeoIP()) {
    progressCb('GeoIP database already exists.');
    return GEOIP_MMDB;
  }
  
  progressCb('Downloading GeoLite2-City database...');
  
  // Use MaxMind's public GeoLite2 database
  const url = 'https://git.io/GeoLite2-City.mmdb';
  
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(GEOIP_MMDB + '.tmp');
    
    https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Follow redirect
        const locUrl = response.headers.location;
        https.get(locUrl, (resp) => {
          const total = parseInt(resp.headers['content-length'], 10);
          let downloaded = 0;
          
          resp.on('data', (chunk) => {
            downloaded += chunk.length;
            if (total) {
              const pct = Math.floor((downloaded / total) * 100);
              if (pct % 10 === 0) {
                progressCb(`Downloading GeoIP: ${pct}%`);
              }
            }
          });
          
          resp.pipe(file);
          file.on('finish', () => {
            file.close();
            fs.renameSync(GEOIP_MMDB + '.tmp', GEOIP_MMDB);
            progressCb('GeoIP database downloaded successfully.');
            resolve(GEOIP_MMDB);
          });
        }).on('error', (err) => {
          fs.unlinkSync(GEOIP_MMDB + '.tmp');
          reject(new Error(`Failed to download GeoIP: ${err.message}`));
        });
      } else {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.renameSync(GEOIP_MMDB + '.tmp', GEOIP_MMDB);
          progressCb('GeoIP database downloaded successfully.');
          resolve(GEOIP_MMDB);
        });
      }
    }).on('error', (err) => {
      fs.unlinkSync(GEOIP_MMDB + '.tmp');
      reject(new Error(`Failed to download GeoIP: ${err.message}`));
    });
  });
}

export function generateFingerprint(options = {}) {
  const osKey = options.os || 'mac';
  const regionKey = options.region || 'us';
  
  const osConfig = OS_OPTIONS[osKey] || OS_OPTIONS['mac'];
  const regionConfig = GEOIP_REGIONS[regionKey] || GEOIP_REGIONS['us'];
  
  const screenResolutions = [
    { width: 1920, height: 1080 },
    { width: 2560, height: 1440 },
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
  ];
  
  const webGLRenderers = {
    'mac': ['Apple M1', 'Apple M2', 'Intel Iris Plus Graphics'],
    'mac-m1': ['Apple M1', 'Apple M2'],
    'mac-intel': ['Intel Iris Plus Graphics', 'Intel UHD Graphics 630'],
    'windows': ['NVIDIA GeForce RTX 3080', 'NVIDIA GeForce RTX 3070', 'AMD Radeon RX 6800'],
    'windows-10': ['NVIDIA GeForce GTX 1660', 'AMD Radeon RX 580'],
    'linux': ['NVIDIA GeForce RTX 3060', 'AMD Radeon RX 6600', 'Mesa Intel Graphics'],
  };
  
  const screen = screenResolutions[Math.floor(Math.random() * screenResolutions.length)];
  const webglRenderer = (webGLRenderers[osKey] || webGLRenderers['mac'])[Math.floor(Math.random() * (webGLRenderers[osKey] || webGLRenderers['mac']).length)];
  
  return {
    os: osConfig.os,
    osVersion: osConfig.osVersion,
    platform: osConfig.platform,
    arch: osConfig.arch || (osConfig.platform === 'darwin' ? 'arm64' : 'x64'),
    cpuCores: osConfig.cpuCores,
    memory: osConfig.memory,
    timezone: regionConfig.timezone,
    locale: regionConfig.locale,
    country: regionConfig.country,
    city: regionConfig.city,
    screen,
    webgl: {
      vendor: 'Google Inc. (Apple)',
      renderer: webglRenderer,
    },
    userAgent: buildUserAgent(osConfig, regionConfig),
  };
}

function buildUserAgent(osConfig, regionConfig) {
  const chromeVersion = '120.0.0.0';
  
  if (osConfig.platform === 'darwin') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  } else if (osConfig.platform === 'win32') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  } else {
    return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }
}

export function listAvailableRegions() {
  return Object.entries(GEOIP_REGIONS).map(([key, config]) => ({
    key,
    country: config.country,
    city: config.city,
    timezone: config.timezone,
  }));
}

export function listAvailableOS() {
  return Object.entries(OS_OPTIONS).map(([key, config]) => ({
    key,
    os: config.os,
    osVersion: config.osVersion,
    platform: config.platform,
  }));
}
