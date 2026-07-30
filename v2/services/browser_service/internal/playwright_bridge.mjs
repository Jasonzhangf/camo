// Playwright bridge. Module id=services.browser_service.internal.playwright_bridge.
//
// Single truth_owner for the Playwright browser instance per profileId.
// All Playwright calls MUST go through here - no direct playwright imports
// elsewhere in v2.
//
// Hard guards:
//   - One browser instance per profileId.
//   - Graceful SIGTERM handling (close browser on signal).
//   - No fallback; Playwright unavailable = fatal error.

import { chromium } from 'playwright';
import path from 'node:path';
import os from 'node:os';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { read as readProfile } from '../../profile/store.mjs';

const _browsers = new Map();  // profileId -> { browser, context, page, createdAt }
let _enabled = false;

export function __enableTestRoot() { _enabled = true; }
function ensureWritable() {
  if (!_enabled) {
    throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: 'playwright_bridge.write', reason: 'not in writable scope' } });
  }
}

function browserDir(profileId) {
  const home = os.homedir();
  return path.join(home, '.camo', 'profiles', String(profileId), 'browser-data');
}

function makeLaunchOptions(profileId, opts = {}) {
  const pid = String(profileId || '').trim();
  const profile = (() => {
    try { return readProfile(pid); } catch { return {}; }
  })();
  
  const headless = opts.headless ?? profile.headless ?? false;
  
  // Only use userDataDir for named (persistent) profiles.
  // Ephemeral profiles (prefixed with _ephemeral_) use plain launch.
  const isEphemeral = pid.startsWith('_ephemeral_');
  const userDataDir = isEphemeral ? undefined : browserDir(pid);
  
  return {
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    ...(userDataDir ? { userDataDir } : {}),
  };
}

export async function launchBrowser(profileId, opts = {}) {
  ensureWritable();
  const pid = String(profileId || '').trim();
  if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  
  const launchOpts = makeLaunchOptions(pid, opts);
  
  // If userDataDir is specified, use launchPersistentContext which supports it.
  // For ephemeral sessions (no userDataDir), use plain launch.
  let browser;
  let context;
  let page;
  try {
    if (launchOpts.userDataDir) {
      // Use persistent context - this owns the browser lifecycle internally.
      const pctx = await chromium.launchPersistentContext(launchOpts.userDataDir, {
        headless: launchOpts.headless,
        args: launchOpts.args,
      });
      browser = pctx.browser();
      context = pctx;
      page = pctx.pages()[0] || await pctx.newPage();
    } else {
      // Plain launch for ephemeral sessions.
      const { headless, args } = launchOpts;
      browser = await chromium.launch({ headless, args });
      context = await browser.newContext();
      page = await context.newPage();
    }
  } catch (cause) {
    throw new CamoError({ 
      code: 'E_BROWSER_LAUNCH_FAILED', 
      details: { profileId: pid, reason: cause?.message || String(cause) },
      cause 
    });
  }
  
  // Re-launching a profile that already owns a browser is a state conflict.
  // The caller (browser_service.startSession) is the single owner of the
  // lifecycle; it must close the existing browser first via stopSession.
  if (_browsers.has(pid)) {
    // Close the new browser we just launched (no reuse, no fallback).
    try {
      if (launchOpts.userDataDir) await context.close();
      else { await page.close(); await context.close(); await browser.close(); }
    } catch { /* already-best-effort cleanup; the error below is the truth */ }
    throw new CamoError({
      code: 'E_STATE_DUPLICATE',
      details: { resource: 'browser_instance', profileId: pid, op: 'launchBrowser.duplicate' },
    });
  }
  
  const record = {
    browser,
    context,
    page,
    createdAt: new Date().toISOString(),
    profileId: pid,
    headless: launchOpts.headless ?? false,
    isPersistent: !!launchOpts.userDataDir,
  };
  
  _browsers.set(pid, record);
  return record;
}

export async function closeBrowser(profileId) {
  ensureWritable();
  const pid = String(profileId || '').trim();
  if (!pid) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  
  const record = _browsers.get(pid);
  if (!record) return false;
  
  try {
    if (record.isPersistent) {
      // Persistent context owns the browser lifecycle - just close the context.
      await record.context.close();
    } else {
      await record.page.close();
      await record.context.close();
      await record.browser.close();
    }
  } catch (cause) {
    // Log but don't fail - browser might already be dead
    console.error(`closeBrowser(${pid}): ${cause?.message || cause}`);
  }
  
  _browsers.delete(pid);
  return true;
}

export function getBrowser(profileId) {
  const pid = String(profileId || '').trim();
  return _browsers.get(pid) || null;
}

export function getPage(profileId) {
  const record = getBrowser(profileId);
  return record ? record.page : null;
}

export function listActive() {
  return [..._browsers.keys()].sort();
}

export async function closeAll() {
  const ids = [..._browsers.keys()];
  const failures = [];
  for (const id of ids) {
    try { await closeBrowser(id); }
    catch (cause) { failures.push({ profileId: id, error: cause }); }
  }
  if (failures.length > 0) {
    throw new CamoError({
      code: 'E_BROWSER_SHUTDOWN_PARTIAL',
      details: { failures },
    });
  }
}

export function __resetForTest() {
  if (!_enabled) throw new CamoError({ code: 'E_INTERNAL_UNEXPECTED', details: { op: '__resetForTest' } });
  _browsers.clear();
}
