// Navigation operations. truth_owner: page_runtime.
//
// Navigation: goto, newTab, closeTab, listTabs.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit, normalizeUrl } from './_page_helpers.mjs';

let _bridge = null;
async function getBridge() {
  if (!_bridge) _bridge = await import('../../browser_service/internal/camoufox_bridge.mjs');
  return _bridge;
}

/**
 * Navigate to a URL.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.url - URL to navigate to
 * @param {string} [opts.waitUntil] - 'load'|'domcontentloaded'|'networkidle'|'commit'
 * @returns {Object} navigation result
 */
export async function goto({ profileId, url, waitUntil = 'load' }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const validUrl = normalizeUrl(url);
  const allowedWaitUntil = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
  const waitVal = allowedWaitUntil.has(waitUntil) ? waitUntil : 'load';
  emit(pid, 'goto.start', { url: validUrl, waitUntil: waitVal });
  try {
    const response = await page.goto(validUrl, { waitUntil: waitVal, timeout: 30000 });
    const result = { profileId: pid, url: validUrl, statusCode: response?.status() ?? null, ok: response?.ok() ?? false, navigated: true, finalUrl: page.url() };
    emit(pid, 'goto.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'goto.error', { url: validUrl, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_NAVIGATION_FAILED', details: { profileId: pid, url: validUrl, reason: cause?.message }, cause });
  }
}

/**
 * Create a new tab.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.url] - URL to open in new tab
 * @returns {Object} new tab result
 */
export async function newTab({ profileId, url }) {
  const pid = safeId(profileId, 'profileId');
  const targetUrl = url == null || url === '' ? null : normalizeUrl(url);
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'newTab.start', { url });
  let page = null;
  try {
    page = await record.context.newPage();
    if (targetUrl) {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    const tabId = record.context.pages().indexOf(page);
    if (tabId < 0) throw new Error('opened page missing from context page list');
    const result = { profileId: pid, tabId, url: page.url(), created: true };
    emit(pid, 'newTab.done', { url: page.url() });
    return result;
  } catch (cause) {
    let cleanupFailure = null;
    if (page) {
      try { await page.close(); }
      catch (closeCause) { cleanupFailure = closeCause?.message || String(closeCause); }
    }
    emit(pid, 'newTab.error', { url, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_NEWTAB_FAILED',
      details: { profileId: pid, url, reason: cause?.message, cleanupFailure },
      cause,
    });
  }
}

/**
 * Close a tab by index.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} opts.tabId - Tab index to close
 * @returns {Object} close tab result
 */
export async function closeTab({ profileId, tabId }) {
  const pid = safeId(profileId, 'profileId');
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'closeTab.start', { tabId });
  try {
    const pages = record.context.pages();
    if (typeof tabId === 'number' && tabId >= 0 && tabId < pages.length) {
      await pages[tabId].close();
    } else {
      throw new CamoError({ code: 'E_INPUT_OUT_OF_RANGE', details: { field: 'tabId', value: tabId, available: pages.length } });
    }
    const result = { profileId: pid, tabId, closed: true };
    emit(pid, 'closeTab.done', { tabId });
    return result;
  } catch (cause) {
    emit(pid, 'closeTab.error', { tabId, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_CLOSETAB_FAILED', details: { profileId: pid, tabId, reason: cause?.message }, cause });
  }
}

/**
 * List all open tabs.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @returns {Object} list tabs result
 */
export async function listTabs({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'listTabs.start', {});
  try {
    const pages = record.context.pages();
    const tabs = await Promise.all(pages.map(async (page, tabId) => ({
      tabId,
      url: page.url(),
      title: await page.title(),
    })));
    const result = { profileId: pid, count: tabs.length, tabs };
    emit(pid, 'listTabs.done', { count: tabs.length });
    return result;
  } catch (cause) {
    emit(pid, 'listTabs.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_LISTTABS_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Switch the active tab to the given tabId (zero-based index into listTabs).
 * Protocol-level: brings the target tab to front and makes it the active page.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} opts.tabId - Zero-based tab index from listTabs
 * @returns {Object} switch result
 */
export async function switchTab({ profileId, tabId }) {
  const pid = safeId(profileId, 'profileId');
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'switchTab.start', { tabId });
  try {
    const r = await bridge.switchPage(pid, tabId);
    const result = { profileId: pid, tabId: r.tabId, url: r.url, switched: true };
    emit(pid, 'switchTab.done', { tabId: r.tabId, url: r.url });
    return result;
  } catch (cause) {
    emit(pid, 'switchTab.error', { tabId, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SWITCHTAB_FAILED', details: { profileId: pid, tabId, reason: cause?.message }, cause });
  }
}

/**
 * Open multiple URLs serially in deterministic tab order, then capture a
 * screenshot of each. Successfully opened tabs remain caller-owned only when
 * the full operation succeeds. Any failure closes all tabs created here.
 *
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string[]} opts.urls - List of absolute http(s) URLs to open
 * @param {string} [opts.outDir] - Directory to save screenshots (default: temp dir)
 * @param {string} [opts.prefix] - Filename prefix for screenshots (default: 'multi-open')
 * @returns {Object} results: { profileId, opened, screenshots: [{tabId,url,path,size}], errors: [] }
 */
export async function multiOpen({ profileId, urls, outDir = null, prefix = 'multi-open' }) {
  const pid = safeId(profileId, 'profileId');
  if (!Array.isArray(urls) || urls.length === 0) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'urls', reason: 'at least one http(s) url required' } });
  }
  const list = urls.map((url) => normalizeUrl(url));
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'multiOpen.start', { count: list.length });
  const opened = [];
  const screenshots = [];
  const createdPages = [];
  try {
    for (let i = 0; i < list.length; i += 1) {
      const url = list[i];
      const page = await record.context.newPage();
      createdPages.push(page);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const tabId = record.context.pages().indexOf(page);
      if (tabId < 0) throw new Error('opened page missing from context page list');
      opened.push({ tabId, url: page.url() });
      let destPath = null;
      if (outDir) {
        const { join } = await import('node:path');
        const safe = String(i + 1).padStart(2, '0');
        destPath = join(outDir, `${prefix}-${safe}.png`);
      }
      const buffer = await page.screenshot({ fullPage: false, type: 'png', path: destPath || undefined });
      screenshots.push({ tabId, url: page.url(), size: buffer?.length ?? 0, path: destPath || null });
    }
  } catch (cause) {
    const cleanupFailures = [];
    for (const page of [...createdPages].reverse()) {
      try { await page.close(); }
      catch (closeCause) { cleanupFailures.push(closeCause?.message || String(closeCause)); }
    }
    emit(pid, 'multiOpen.error', { error: cause?.message, cleanupFailures });
    throw new CamoError({
      code: 'E_BROWSER_MULTIOPEN_FAILED',
      details: { profileId: pid, reason: cause?.message, cleanupFailures },
      cause,
    });
  }
  const result = { profileId: pid, opened, screenshots, errors: [] };
  emit(pid, 'multiOpen.done', { opened: opened.length, screenshots: screenshots.length, errors: 0 });
  return result;
}
