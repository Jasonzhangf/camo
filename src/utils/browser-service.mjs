#!/usr/bin/env node
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BROWSER_SERVICE_URL, loadConfig, setRepoRoot } from './config.mjs';
import { touchSessionActivity } from '../lifecycle/session-registry.mjs';
import { buildResolvedSessionView, resolveSessionViewByProfile } from '../lifecycle/session-view.mjs';

const require = createRequire(import.meta.url);
const DEFAULT_API_TIMEOUT_MS = 90000;

function resolveApiTimeoutMs(options = {}) {
  const optionValue = Number(options?.timeoutMs);
  if (Number.isFinite(optionValue) && optionValue > 0) {
    return Math.max(1000, Math.floor(optionValue));
  }
  const envValue = Number(process.env.CAMO_API_TIMEOUT_MS);
  if (Number.isFinite(envValue) && envValue > 0) {
    return Math.max(1000, Math.floor(envValue));
  }
  return DEFAULT_API_TIMEOUT_MS;
}

function resolveWsUrl() {
  const cfg = loadConfig();
  const explicit = String(process.env.CAMO_WS_URL || '').trim();
  if (explicit) return explicit;
  const host = String(process.env.CAMO_WS_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(process.env.CAMO_WS_PORT || 8765) || 8765;
  return `ws://${host}:${port}`;
}

async function openWs() {
  if (typeof WebSocket !== 'function') {
    throw new Error('Global WebSocket is unavailable in this Node runtime');
  }
  const wsUrl = resolveWsUrl();
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error(`WebSocket connect timeout: ${wsUrl}`));
    }, 8000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket connect failed: ${err?.message || String(err)}`));
    });
  });
}

export async function callWS(action, payload = {}, options = {}) {
  const timeoutMs = resolveApiTimeoutMs(options);
  const socket = await openWs();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const sessionId = String(payload?.profileId || payload?.sessionId || payload?.profile || '').trim();
  const message = {
    type: 'command',
    request_id: requestId,
    session_id: sessionId,
    data: { command_type: 'dev_command', action, parameters: payload },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error(`browser-service ws timeout after ${timeoutMs}ms: ${action}`));
    }, timeoutMs);

    socket.addEventListener('message', (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : JSON.parse(String(event.data));
        if (data?.type === 'response' && data.request_id === requestId) {
          clearTimeout(timer);
          try { socket.close(); } catch {}
          resolve(data?.data ?? data);
        }
      } catch (err) {
        clearTimeout(timer);
        try { socket.close(); } catch {}
        reject(err);
      }
    });

    socket.send(JSON.stringify(message));
  });
}

export function findRepoRootCandidate() {
  return null;
}

function isTimeoutError(error) {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    name.includes('timeout')
    || name.includes('abort')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('aborted')
  );
}

function shouldTrackSessionActivity(action, payload) {
  const profileId = String(payload?.profileId || '').trim();
  if (!profileId) return false;
  if (action === 'getStatus' || action === 'service:shutdown' || action === 'stop') return false;
  return true;
}

export async function callAPI(action, payload = {}, options = {}) {
  const timeoutMs = resolveApiTimeoutMs(options);
  let r;
  try {
    r = await fetch(`${BROWSER_SERVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args: payload }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new Error(`browser-service timeout after ${timeoutMs}ms: ${action}`);
    }
    throw error;
  }

  let body;
  try {
    body = await r.json();
  } catch {
    const text = await r.text();
    throw new Error(`HTTP ${r.status}: ${text}`);
  }

  if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
  if (shouldTrackSessionActivity(action, payload)) {
    touchSessionActivity(payload.profileId, {
      lastAction: String(action || '').trim() || null,
      lastActionAt: Date.now(),
    });
  }
  return body;
}

export async function getSessionByProfile(profileId) {
  const status = await callAPI('getStatus', {});
  if (!profileId) {
    return null;
  }
  const liveSessions = Array.isArray(status?.sessions) ? status.sessions : [];
  const resolved = resolveSessionViewByProfile(profileId, liveSessions);
  if (resolved?.live) {
    const activeSession = liveSessions.find((session) => String(session?.profileId || '').trim() === resolved.profileId) || null;
    if (activeSession) return activeSession;
  }
  if (!resolved?.live) {
    return null;
  }

  // Some browser-service builds do not populate current_url reliably.
  // Fallback to page:list only to enrich an already-live profile.
  try {
    const pagePayload = await callAPI('page:list', { profileId });
    const pages = Array.isArray(pagePayload?.pages)
      ? pagePayload.pages
      : Array.isArray(pagePayload?.data?.pages)
        ? pagePayload.data.pages
        : [];
    if (!pages.length) return null;
    const activeIndex = Number(pagePayload?.activeIndex ?? pagePayload?.data?.activeIndex);
    const activePage = Number.isFinite(activeIndex)
      ? pages.find((page) => Number(page?.index) === activeIndex)
      : (pages.find((page) => page?.active) || pages[0]);
    return {
      profileId,
      session_id: profileId,
      sessionId: profileId,
      current_url: activePage?.url || null,
      recoveredFromPages: true,
    };
  } catch {
    return null;
  }
}

export async function getResolvedSessions() {
  const status = await callAPI('getStatus', {});
  const liveSessions = Array.isArray(status?.sessions) ? status.sessions : [];
  return buildResolvedSessionView(liveSessions);
}

function buildDomSnapshotScript(maxDepth, maxChildren) {
  return `(() => {
    const MAX_DEPTH = ${maxDepth};
    const MAX_CHILDREN = ${maxChildren};
    const viewportWidth = Number(window.innerWidth || 0);
    const viewportHeight = Number(window.innerHeight || 0);

    const normalizeRect = (rect) => {
      if (!rect) return null;
      const left = Number(rect.left ?? rect.x ?? 0);
      const top = Number(rect.top ?? rect.y ?? 0);
      const width = Number(rect.width ?? 0);
      const height = Number(rect.height ?? 0);
      return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        x: left,
        y: top,
        width,
        height,
      };
    };

    const sanitizeClasses = (el) => {
      const classAttr = typeof el.className === 'string'
        ? el.className
        : (el.getAttribute && el.getAttribute('class')) || '';
      return classAttr.split(/\\s+/).filter(Boolean).slice(0, 24);
    };

    const collectAttrs = (el) => {
      if (!el || !el.getAttribute) return null;
      const keys = [
        'href',
        'src',
        'name',
        'type',
        'value',
        'placeholder',
        'role',
        'aria-label',
        'aria-hidden',
        'title',
      ];
      const attrs = {};
      for (const key of keys) {
        const value = el.getAttribute(key);
        if (value === null || value === undefined || value === '') continue;
        attrs[key] = String(value).slice(0, 400);
      }
      return Object.keys(attrs).length > 0 ? attrs : null;
    };

    const inViewport = (rect) => {
      if (!rect) return false;
      if (rect.width <= 0 || rect.height <= 0) return false;
      return (
        rect.right > 0
        && rect.bottom > 0
        && rect.left < viewportWidth
        && rect.top < viewportHeight
      );
    };

    const isRendered = (el) => {
      try {
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        const opacity = Number.parseFloat(String(style.opacity || '1'));
        if (Number.isFinite(opacity) && opacity <= 0.01) return false;
        return true;
      } catch {
        return false;
      }
    };

    const clampPoint = (value, max) => {
      if (!Number.isFinite(value)) return 0;
      if (max <= 1) return 0;
      return Math.max(0, Math.min(max - 1, value));
    };

    const hitTestVisible = (el, rect) => {
      if (!rect || viewportWidth <= 0 || viewportHeight <= 0) return false;
      const samplePoints = [
        [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
        [rect.left + rect.width * 0.2, rect.top + rect.height * 0.2],
        [rect.left + rect.width * 0.8, rect.top + rect.height * 0.8],
      ];
      for (const [rawX, rawY] of samplePoints) {
        const x = clampPoint(rawX, viewportWidth);
        const y = clampPoint(rawY, viewportHeight);
        const topEl = document.elementFromPoint(x, y);
        if (!topEl) continue;
        if (topEl === el) return true;
        if (el.contains && el.contains(topEl)) return true;
        if (topEl.contains && topEl.contains(el)) return true;
      }
      return false;
    };

    const collect = (el, depth = 0, path = 'root') => {
      if (!el || depth > MAX_DEPTH) return null;
      const classes = sanitizeClasses(el);
      const rect = normalizeRect(el.getBoundingClientRect ? el.getBoundingClientRect() : null);
      const tag = String(el.tagName || el.nodeName || '').toLowerCase();
      const id = el.id || null;
      const text = typeof el.textContent === 'string'
        ? el.textContent.replace(/\\s+/g, ' ').trim()
        : '';
      const selector = tag
        ? \`\${tag}\${id ? '#' + id : ''}\${classes.length ? '.' + classes.slice(0, 3).join('.') : ''}\`
        : null;

      const node = {
        tag,
        id,
        classes,
        selector,
        path,
      };
      const attrs = collectAttrs(el);
      if (attrs) node.attrs = attrs;
      if (attrs && attrs.href) node.href = attrs.href;
      if (rect) node.rect = rect;
      if (text) node.textSnippet = text.slice(0, 120);
      if (rect) {
        const rendered = isRendered(el);
        const withinViewport = inViewport(rect);
        const visible = rendered && withinViewport && hitTestVisible(el, rect);
        node.visible = visible;
      } else {
        node.visible = false;
      }

      const children = Array.from(el.children || []);
      if (children.length > 0 && depth < MAX_DEPTH) {
        node.children = [];
        const limit = Math.min(children.length, MAX_CHILDREN);
        for (let i = 0; i < limit; i += 1) {
          const child = collect(children[i], depth + 1, \`\${path}/\${i}\`);
          if (child) node.children.push(child);
        }
      }

      return node;
    };

    const root = collect(document.body || document.documentElement, 0, 'root');
    return {
      dom_tree: root,
      viewport: {
        width: viewportWidth,
        height: viewportHeight,
      },
    };
  })()`;
}

export async function getDomSnapshotByProfile(profileId, options = {}) {
  const maxDepth = Math.max(1, Math.min(20, Number(options.maxDepth) || 10));
  const maxChildren = Math.max(1, Math.min(500, Number(options.maxChildren) || 120));
  const response = await callAPI('evaluate', {
    profileId,
    script: buildDomSnapshotScript(maxDepth, maxChildren),
  });
  const payload = response?.result || response || {};
  const tree = payload.dom_tree || null;
  if (tree && payload.viewport && typeof payload.viewport === 'object') {
    tree.__viewport = {
      width: Number(payload.viewport.width) || 0,
      height: Number(payload.viewport.height) || 0,
    };
  }
  return tree;
}

export async function getViewportByProfile(profileId) {
  const response = await callAPI('evaluate', {
    profileId,
    script: `(() => ({ width: Number(window.innerWidth || 0), height: Number(window.innerHeight || 0) }))()`,
  });
  const viewport = response?.result || response?.viewport || {};
  const width = Number(viewport?.width) || 1280;
  const height = Number(viewport?.height) || 720;
  return { width, height };
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

const CONTROLLER_SERVER_REL = path.join('src', 'services', 'browser-service', 'index.js');


function hasControllerServer(root) {
  if (!root) return false;
  return fs.existsSync(path.join(root, CONTROLLER_SERVER_REL));
}





function scanCommonInstallRoots() {
  const home = os.homedir();
  const appData = String(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'));
  const npmPrefix = String(process.env.npm_config_prefix || '').trim();
  const nodeModuleRoots = [
    path.join(appData, 'npm', 'node_modules'),
    path.join(home, 'AppData', 'Roaming', 'npm', 'node_modules'),
    npmPrefix ? path.join(npmPrefix, 'node_modules') : '',
    npmPrefix ? path.join(npmPrefix, 'lib', 'node_modules') : '',
    '/usr/local/lib/node_modules',
    '/usr/lib/node_modules',
    path.join(home, '.npm-global', 'lib', 'node_modules'),
  ].filter(Boolean);

  for (const root of nodeModuleRoots) {
    const candidate = path.join(root, '@web-auto', 'camo');
    if (hasControllerServer(candidate)) return candidate;
  }
  return null;
}






export function findInstallRootCandidate() {
  const cfg = loadConfig();
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const siblingInScopedNodeModules = path.resolve(currentDir, '..', '..', '..', 'camo');
  const candidates = [
    process.env.CAMO_INSTALL_DIR,
    process.env.CAMO_PACKAGE_ROOT,
    process.env.CAMO_REPO_ROOT,
    cfg.repoRoot,
    siblingInScopedNodeModules,
    process.cwd(),
  ].filter(Boolean);

  try {
    const pkgPath = require.resolve('@web-auto/camo/package.json');
    candidates.push(path.dirname(pkgPath));
  } catch {
    // ignore resolution failures in npx-only environments
  }

  const seen = new Set();
  for (const raw of candidates) {
    const resolved = path.resolve(String(raw));
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    if (hasControllerServer(resolved)) return resolved;
  }

  return scanCommonInstallRoots();
}

export async function ensureBrowserService() {
  if (await checkBrowserService()) return;

  const installRoot = findInstallRootCandidate();
  if (!installRoot) {
    throw new Error(
      `Cannot locate browser-service launcher (${CONTROLLER_SERVER_REL}). ` +
      'Ensure @web-auto/camo is installed or set CAMO_INSTALL_DIR.',
    );
  }
  const scriptPath = path.join(installRoot, CONTROLLER_SERVER_REL);
  const env = {
    ...process.env,
    CAMO_REPO_ROOT: String(process.env.CAMO_REPO_ROOT || '').trim() || installRoot,
  };
  const child = spawn(process.execPath, [scriptPath], {
    cwd: installRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env,
  });
  child.unref();
  console.log(`Starting browser-service daemon (pid=${child.pid || 'unknown'})...`);

  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 400));
    if (await checkBrowserService()) {
      console.log('Browser-service is ready.');
      return;
    }
  }

  throw new Error('Browser-service failed to become healthy within timeout');
}
