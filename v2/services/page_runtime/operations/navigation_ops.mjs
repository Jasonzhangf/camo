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
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'newTab.start', { url });
  try {
    const page = await record.browser.newPage();
    if (url && /^https?:\/\//.test(url)) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    const result = { profileId: pid, tabId: page._id || page.guid || null, url: page.url(), created: true };
    emit(pid, 'newTab.done', { url: page.url() });
    return result;
  } catch (cause) {
    emit(pid, 'newTab.error', { url, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_NEWTAB_FAILED', details: { profileId: pid, url, reason: cause?.message }, cause });
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
    const tabs = pages.map((p, i) => ({ tabId: i, url: p.url(), title: p._title || '' }));
    const result = { profileId: pid, count: tabs.length, tabs };
    emit(pid, 'listTabs.done', { count: tabs.length });
    return result;
  } catch (cause) {
    emit(pid, 'listTabs.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_LISTTABS_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}
