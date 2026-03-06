#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function hasDrive(letter) {
  if (process.platform !== 'win32') return false;
  try {
    return fs.existsSync(`${String(letter || '').replace(/[^A-Za-z]/g, '').toUpperCase()}:\\`);
  } catch {
    return false;
  }
}

function normalizePathForPlatform(input, platform = process.platform) {
  const raw = String(input || '').trim();
  const isWinPath = platform === 'win32' || /^[A-Za-z]:[\\/]/.test(raw);
  const pathApi = isWinPath ? path.win32 : path;
  return isWinPath ? pathApi.normalize(raw) : path.resolve(raw);
}

function normalizeLegacyCamoRoot(input, platform = process.platform) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const resolved = normalizePathForPlatform(input, platform);
  const base = pathApi.basename(resolved).toLowerCase();
  if (base === '.camo' || base === 'camo') return resolved;
  return pathApi.join(resolved, '.camo');
}

export function resolveCamoRoot(options = {}) {
  const env = options.env || process.env;
  const platform = String(options.platform || process.platform);
  const pathApi = platform === 'win32' ? path.win32 : path;
  const homeDir = String(options.homeDir || os.homedir());
  const explicitDataRoot = String(env.CAMO_DATA_ROOT || env.CAMO_HOME || '').trim();
  if (explicitDataRoot) return normalizePathForPlatform(explicitDataRoot, platform);

  const legacyRoot = String(env.CAMO_ROOT || env.CAMO_PORTABLE_ROOT || '').trim();
  if (legacyRoot) return normalizeLegacyCamoRoot(legacyRoot, platform);

  const dDriveExists = typeof options.hasDDrive === 'boolean'
    ? options.hasDDrive
    : hasDrive('D');
  if (platform === 'win32') {
    return dDriveExists ? 'D:\\camo' : pathApi.join(homeDir, '.camo');
  }
  return pathApi.join(homeDir, '.camo');
}

// Backward-compatible export name; camo no longer uses legacy paths.
export function resolveLegacyRoot(options = {}) {
  return resolveCamoRoot(options);
}

export function resolveProfilesDir(options = {}) {
  const env = options.env || process.env;
  const platform = String(options.platform || process.platform);
  const explicitProfileRoot = String(env.CAMO_PROFILE_ROOT || env.CAMO_PATHS_PROFILES || '').trim();
  if (explicitProfileRoot) {
    return normalizePathForPlatform(explicitProfileRoot, platform);
  }
  const pathApi = platform === 'win32' ? path.win32 : path;
  return pathApi.join(resolveCamoRoot(options), 'profiles');
}

export const CONFIG_DIR = resolveCamoRoot();
export const PROFILES_DIR = resolveProfilesDir();
export const CONFIG_FILE = path.join(CONFIG_DIR, 'camo-cli.json');
export const PROFILE_META_FILE = 'camo-profile.json';
export const BROWSER_SERVICE_URL = process.env.CAMO_BROWSER_URL
  || process.env.CAMO_BROWSER_HTTP_URL
  || (process.env.CAMO_BROWSER_HOST ? `http://${process.env.CAMO_BROWSER_HOST}` : '')
  || 'http://127.0.0.1:7704';

export function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function readJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeJson(p, data) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function loadConfig() {
  const raw = readJson(CONFIG_FILE) || {};
  return {
    defaultProfile: typeof raw.defaultProfile === 'string' ? raw.defaultProfile : null,
    repoRoot: typeof raw.repoRoot === 'string' ? raw.repoRoot : null,
    highlightMode: typeof raw.highlightMode === 'boolean' ? raw.highlightMode : true,
  };
}

export function saveConfig(config) {
  writeJson(CONFIG_FILE, config);
}

export function listProfiles() {
  if (!fs.existsSync(PROFILES_DIR)) return [];
  return fs.readdirSync(PROFILES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => !name.includes(':') && !name.includes('/') && !name.startsWith('.'))
    .sort();
}

export function isValidProfileId(profileId) {
  return typeof profileId === 'string' && /^[a-zA-Z0-9._-]+$/.test(profileId);
}

export function createProfile(profileId) {
  if (!isValidProfileId(profileId)) {
    throw new Error('Invalid profileId. Use only letters, numbers, dot, underscore, dash.');
  }
  const profileDir = getProfileDir(profileId);
  if (fs.existsSync(profileDir)) throw new Error(`Profile already exists: ${profileId}`);
  ensureDir(profileDir);
}

export function deleteProfile(profileId) {
  const profileDir = getProfileDir(profileId);
  if (!fs.existsSync(profileDir)) throw new Error(`Profile not found: ${profileId}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
}

export function setDefaultProfile(profileId) {
  const cfg = loadConfig();
  cfg.defaultProfile = profileId;
  saveConfig(cfg);
}

export function setRepoRoot(repoRoot) {
  const cfg = loadConfig();
  cfg.repoRoot = repoRoot;
  saveConfig(cfg);
}

export function getDefaultProfile() {
  return loadConfig().defaultProfile;
}

export function getHighlightMode() {
  return loadConfig().highlightMode !== false;
}

export function setHighlightMode(enabled) {
  const cfg = loadConfig();
  cfg.highlightMode = enabled !== false;
  saveConfig(cfg);
  return cfg.highlightMode;
}

export function getProfileDir(profileId) {
  return path.join(PROFILES_DIR, String(profileId || '').trim());
}

export function getProfileMetaFile(profileId) {
  return path.join(getProfileDir(profileId), PROFILE_META_FILE);
}

function loadProfileMeta(profileId) {
  if (!isValidProfileId(profileId)) return {};
  return readJson(getProfileMetaFile(profileId)) || {};
}

function saveProfileMeta(profileId, patch) {
  if (!isValidProfileId(profileId)) return null;
  const profileDir = getProfileDir(profileId);
  ensureDir(profileDir);
  const current = loadProfileMeta(profileId);
  const next = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  writeJson(getProfileMetaFile(profileId), next);
  return next;
}

export function getProfileWindowSize(profileId) {
  const meta = loadProfileMeta(profileId);
  const width = Number(meta?.window?.width);
  const height = Number(meta?.window?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < 320 || height < 240) return null;
  return {
    width: Math.floor(width),
    height: Math.floor(height),
    updatedAt: Number(meta?.window?.updatedAt) || Number(meta?.updatedAt) || null,
  };
}

export function setProfileWindowSize(profileId, width, height) {
  const parsedWidth = Number(width);
  const parsedHeight = Number(height);
  if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) return null;
  if (parsedWidth < 320 || parsedHeight < 240) return null;
  const now = Date.now();
  return saveProfileMeta(profileId, {
    window: {
      width: Math.floor(parsedWidth),
      height: Math.floor(parsedHeight),
      updatedAt: now,
    },
 });
}
