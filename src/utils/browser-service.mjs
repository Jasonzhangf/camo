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
  const activeSession = status?.sessions?.find((s) => s.profileId === profileId) || null;
  if (activeSession) {
    return activeSession;
  }
  if (!profileId) {
    return null;
  }

  // Some browser-service builds do not populate getStatus.sessions reliably.
  // Fallback to page:list so runtime can still attach to an active profile tab set.
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
