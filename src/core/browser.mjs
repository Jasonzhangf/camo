/**
 * Core browser control module - Direct camoufox integration
 * No external browser-service dependency
 */
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CONFIG_DIR = path.join(os.homedir(), '.webauto');
const PROFILES_DIR = path.join(CONFIG_DIR, 'profiles');

// Active browser instances registry (in-memory)
const activeBrowsers = new Map();

/**
 * Detect camoufox executable path
 */
export function detectCamoufoxPath() {
  try {
    const cmd = process.platform === 'win32' ? 'python -m camoufox path' : 'python3 -m camoufox path';
    const out = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
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

/**
 * Ensure camoufox is installed
 */
export async function ensureCamoufox() {
  const camoufoxPath = detectCamoufoxPath();
  if (camoufoxPath) return camoufoxPath;

  console.log('Camoufox not found. Installing...');
  try {
    execSync('npx --yes --package=camoufox camoufox fetch', { stdio: 'inherit' });
    const newPath = detectCamoufoxPath();
    if (!newPath) throw new Error('Camoufox install finished but executable was not detected');
    console.log('Camoufox installed at:', newPath);
    return newPath;
  } catch (err) {
    throw new Error(`Failed to install camoufox: ${err.message}`);
  }
}

/**
 * Get profile directory
 */
export function getProfileDir(profileId) {
  return path.join(PROFILES_DIR, profileId);
}

/**
 * Ensure profile exists
 */
export function ensureProfile(profileId) {
  const profileDir = getProfileDir(profileId);
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }
  return profileDir;
}

/**
 * Check if browser is running for profile
 */
export function isBrowserRunning(profileId) {
  const browser = activeBrowsers.get(profileId);
  if (!browser) return false;
  return browser.process && !browser.process.killed;
}

/**
 * Launch browser for profile
 */
export async function launchBrowser(profileId, options = {}) {
  if (isBrowserRunning(profileId)) {
    throw new Error(`Browser already running for profile: ${profileId}`);
  }

  const camoufoxPath = await ensureCamoufox();
  const profileDir = ensureProfile(profileId);

  // Build launch arguments
  const args = [
    '-P', profileDir,
    '--headless=false',
  ];

  if (options.url) {
    args.push('-url', options.url);
  }

  // Launch camoufox
  const browserProcess = spawn(camoufoxPath, args, {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const browser = {
    profileId,
    process: browserProcess,
    profileDir,
    startTime: Date.now(),
    pages: [],
    currentPage: 0,
    wsEndpoint: null,
  };

  activeBrowsers.set(profileId, browser);

  // Handle process exit
  browserProcess.on('exit', (code) => {
    activeBrowsers.delete(profileId);
  });

  // Wait for browser to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      browserProcess.kill();
      reject(new Error('Browser failed to start within timeout'));
    }, 30000);

    // Check for ready signal in stdout
    browserProcess.stdout.on('data', (data) => {
      const line = data.toString();
      if (line.includes('Browser ready') || line.includes('Listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });

    // Also resolve after a short delay as fallback
    setTimeout(() => {
      clearTimeout(timeout);
      resolve();
    }, 5000);
  });

  return browser;
}

/**
 * Stop browser for profile
 */
export async function stopBrowser(profileId) {
  const browser = activeBrowsers.get(profileId);
  if (!browser) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  if (browser.process && !browser.process.killed) {
    browser.process.kill('SIGTERM');
    // Wait for graceful shutdown
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (browser.process && !browser.process.killed) {
          browser.process.kill('SIGKILL');
        }
        resolve();
      }, 5000);

      browser.process.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  activeBrowsers.delete(profileId);
  return { ok: true, profileId, stopped: true };
}

/**
 * Get browser status
 */
export function getBrowserStatus(profileId) {
  if (profileId) {
    const browser = activeBrowsers.get(profileId);
    if (!browser) return null;
    return {
      profileId,
      running: isBrowserRunning(profileId),
      startTime: browser.startTime,
      uptime: Date.now() - browser.startTime,
      pages: browser.pages,
      currentPage: browser.currentPage,
    };
  }

  // Return all sessions
  return Array.from(activeBrowsers.entries()).map(([id, b]) => ({
    profileId: id,
    running: isBrowserRunning(id),
    startTime: b.startTime,
    uptime: Date.now() - b.startTime,
    pages: b.pages,
    currentPage: b.currentPage,
  }));
}

/**
 * Get Playwright browser instance for profile
 * Creates one if needed using camoufox-js
 */
export async function getPlaywrightBrowser(profileId) {
  const { chromium } = await import('playwright');
  
  const browser = activeBrowsers.get(profileId);
  if (!browser) {
    throw new Error(`No browser session for profile: ${profileId}. Run 'camo start ${profileId}' first.`);
  }

  if (browser.pwBrowser) {
    return browser.pwBrowser;
  }

  // Connect to camoufox using CDP
  const pwBrowser = await chromium.connectOverCDP(browser.wsEndpoint || 'http://127.0.0.1:9222');
  browser.pwBrowser = pwBrowser;
  return pwBrowser;
}

/**
 * Get current page for profile
 */
export async function getCurrentPage(profileId) {
  const browser = activeBrowsers.get(profileId);
  if (!browser) {
    throw new Error(`No browser session for profile: ${profileId}`);
  }

  if (browser.currentPage) {
    return browser.currentPage;
  }

  // Get page from Playwright
  const pwBrowser = await getPlaywrightBrowser(profileId);
  const contexts = pwBrowser.contexts();
  if (contexts.length === 0) {
    throw new Error('No browser contexts available');
  }
  const pages = contexts[0].pages();
  if (pages.length === 0) {
    throw new Error('No pages available');
  }

  browser.currentPage = pages[pages.length - 1];
  return browser.currentPage;
}


/**
 * Get active browser (alias for registry lookup)
 */
export function getActiveBrowser(profileId) {
  return activeBrowsers.get(profileId) || null;
}

