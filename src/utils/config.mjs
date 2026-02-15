#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const CONFIG_DIR = path.join(os.homedir(), '.webauto');
export const PROFILES_DIR = path.join(CONFIG_DIR, 'profiles');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'camo-cli.json');
export const BROWSER_SERVICE_URL = process.env.WEBAUTO_BROWSER_URL || 'http://127.0.0.1:7704';

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
  const profileDir = path.join(PROFILES_DIR, profileId);
  if (fs.existsSync(profileDir)) throw new Error(`Profile already exists: ${profileId}`);
  ensureDir(profileDir);
}

export function deleteProfile(profileId) {
  const profileDir = path.join(PROFILES_DIR, profileId);
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

const START_SCRIPT_REL = path.join('runtime', 'infra', 'utils', 'scripts', 'service', 'start-browser-service.mjs');

export function hasStartScript(root) {
  if (!root) return false;
  return fs.existsSync(path.join(root, START_SCRIPT_REL));
}
