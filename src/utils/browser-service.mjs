#!/usr/bin/env node
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { BROWSER_SERVICE_URL, loadConfig, setRepoRoot } from './config.mjs';

export async function callAPI(action, payload = {}) {
  const r = await fetch(`${BROWSER_SERVICE_URL}/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args: payload }),
  });

  let body;
  try {
    body = await r.json();
  } catch {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text}`);
  }

  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  return body;
}

export async function getSessionByProfile(profileId) {
  const status = await callAPI('getStatus', {});
  return status?.sessions?.find((s) => s.profileId === profileId) || null;
}

export async function checkBrowserService() {
  try {
    const r = await fetch(`${BROWSER_SERVICE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

export function detectCamoufoxPath() {
  try {
    const cmd = process.platform === 'win32' ? 'python -m camoufox path' : 'python3 -m camoufox path';
    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = out.trim().split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i].trim();
      if (line && (line.startsWith('/') || line.match(/^[A-Z]:\\/))) return line;
    }
  } catch {
    return null;
  }
  return null;
}

export function ensureCamoufox() {
  if (detectCamoufoxPath()) return;
  console.log('Camoufox is not found. Installing...');
  execSync('npx --yes --package=camoufox camoufox fetch', { stdio: 'inherit' });
  if (!detectCamoufoxPath()) {
    throw new Error('Camoufox install finished but executable was not detected');
  }
  console.log('Camoufox installed.');
}

const START_SCRIPT_REL = path.join('runtime', 'infra', 'utils', 'scripts', 'service', 'start-browser-service.mjs');

function hasStartScript(root) {
  if (!root) return false;
  return fs.existsSync(path.join(root, START_SCRIPT_REL));
}

function walkUpForRepoRoot(startDir) {
  if (!startDir) return null;
  let cursor = path.resolve(startDir);
  for (;;) {
    if (hasStartScript(cursor)) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function scanCommonRepoRoots() {
  const home = os.homedir();
  const roots = [
    path.join(home, 'Documents', 'github'),
    path.join(home, 'github'),
  path.join(home, 'code'),
    path.join(home, 'projects'),
  path.join('/Volumes', 'extension', 'code'),
  path.join('C:', 'code'),
  path.join('D:', 'code'),
  path.join('C:', 'projects'),
  path.join('D:', 'projects'),
  path.join('C:', 'Users', os.userInfo().username, 'code'),
  path.join('C:', 'Users', os.userInfo().username, 'projects'),
    path.join('C:', 'Users', os.userInfo().username, 'Documents', 'github'),
  ].filter(Boolean);

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.toLowerCase().includes('webauto')) continue;
        const candidate = path.join(root, entry.name);
        if (hasStartScript(candidate)) return candidate;
      }
    } catch {
      // ignore scanning errors and continue
    }
  }

  return null;
}

export function findRepoRootCandidate() {
  const cfg = loadConfig();
  const candidates = [
    process.env.WEBAUTO_REPO_ROOT,
    cfg.repoRoot,
    process.cwd(),
    path.join('/Volumes', 'extension', 'code', 'webauto'),
    path.join('/Volumes', 'extension', 'code', 'WebAuto'),
    path.join(os.homedir(), 'Documents', 'github', 'webauto'),
    path.join(os.homedir(), 'Documents', 'github', 'WebAuto'),
    path.join(os.homedir(), 'github', 'webauto'),
    path.join(os.homedir(), 'github', 'WebAuto'),
    path.join('C:', 'code', 'webauto'),
    path.join('C:', 'code', 'WebAuto'),
    path.join('C:', 'Users', os.userInfo().username, 'code', 'webauto'),
    path.join('C:', 'Users', os.userInfo().username, 'code', 'WebAuto'),
  ].filter(Boolean);

  for (const root of candidates) {
    if (hasStartScript(root)) {
      if (cfg.repoRoot !== root) {
        setRepoRoot(root);
      }
      return root;
    }
  }

  for (const startDir of [process.cwd()]) {
    const found = walkUpForRepoRoot(startDir);
    if (found) {
      if (cfg.repoRoot !== found) {
        setRepoRoot(found);
      }
      return found;
    }
  }

  const scanned = scanCommonRepoRoots();
  if (scanned) {
    if (cfg.repoRoot !== scanned) {
      setRepoRoot(scanned);
    }
    return scanned;
  }

  return null;
}

export async function ensureBrowserService() {
  if (await checkBrowserService()) return;

  const repoRoot = findRepoRootCandidate();
  if (!repoRoot) {
    throw new Error(
      `Cannot locate browser-service start script (${START_SCRIPT_REL}). ` +
      'Run from webauto repo once or set WEBAUTO_REPO_ROOT=/path/to/webauto.',
    );
  }

  const scriptPath = path.join(repoRoot, START_SCRIPT_REL);
  console.log('Starting browser-service daemon...');
  execSync(`node "${scriptPath}"`, { stdio: 'inherit', cwd: repoRoot });

  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    if (await checkBrowserService()) {
      console.log('Browser-service is ready.');
      return;
    }
  }

  throw new Error('Browser-service failed to become healthy within timeout');
}
