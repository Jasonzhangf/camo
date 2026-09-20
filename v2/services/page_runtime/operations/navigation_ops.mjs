// Navigation operations. truth_owner: page_runtime.
//
// Navigation: goto, newTab, closeTab, listTabs.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getTargetPageOrThrow, emit, normalizeUrl } from './_page_helpers.mjs';

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
export async function goto({ profileId, target, url, waitUntil = 'load' }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const validUrl = normalizeUrl(url);
  const allowedWaitUntil = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
  const waitVal = allowedWaitUntil.has(waitUntil) ? waitUntil : 'load';
  emit(pid, 'goto.start', { url: validUrl, waitUntil: waitVal });
  try {
    const response = await page.goto(validUrl, { waitUntil: waitVal, timeout: 30000 });
    const result = {
      profileId: pid,
      targetId: target.targetId,
      url: validUrl,
      statusCode: response?.status() ?? null,
      ok: response?.ok() ?? false,
      navigated: true,
      finalUrl: page.url(),
    };
    emit(pid, 'goto.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'goto.error', { url: validUrl, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_NAVIGATION_FAILED', details: { profileId: pid, url: validUrl, reason: cause?.message }, cause });
  }
}

/**
 * Go back one history entry in the active page.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @returns {Object} navigation result
 */
export async function back({ profileId, target }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  emit(pid, 'back.start', {});
  try {
    const response = await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = { profileId: pid, targetId: target.targetId, navigated: response !== null, finalUrl: page.url() };
    emit(pid, 'back.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'back.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_NAVIGATION_FAILED', details: { profileId: pid, op: 'back', reason: cause?.message }, cause });
  }
}

/**
 * Go forward one history entry in the active page.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @returns {Object} navigation result
 */
export async function forward({ profileId, target }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  emit(pid, 'forward.start', {});
  try {
    const response = await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 });
    const result = { profileId: pid, targetId: target.targetId, navigated: response !== null, finalUrl: page.url() };
    emit(pid, 'forward.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'forward.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_NAVIGATION_FAILED', details: { profileId: pid, op: 'forward', reason: cause?.message }, cause });
  }
}

/**
 * Reload the active page.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.waitUntil] - 'load'|'domcontentloaded'|'networkidle'|'commit'
 * @returns {Object} navigation result
 */
export async function reload({ profileId, target, waitUntil = 'load' }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const allowedWaitUntil = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
  const waitVal = allowedWaitUntil.has(waitUntil) ? waitUntil : 'load';
  emit(pid, 'reload.start', { waitUntil: waitVal });
  try {
    const response = await page.reload({ waitUntil: waitVal, timeout: 30000 });
    const result = {
      profileId: pid,
      targetId: target.targetId,
      reloaded: true,
      statusCode: response?.status() ?? null,
      ok: response?.ok() ?? false,
      finalUrl: page.url(),
    };
    emit(pid, 'reload.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'reload.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_NAVIGATION_FAILED', details: { profileId: pid, op: 'reload', reason: cause?.message }, cause });
  }
}

/**
 * Create a new tab in the target's browser context.
 *
 * The returned page handle is internal. The daemon allocates the external
 * target id for the new page; page runtime never mints caller-visible ids.
 *
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {Object} opts.target - Resolved target handle owned by daemon
 * @param {string} [opts.url] - URL to open in new tab
 * @returns {Object} new tab result with internal page handle
 */
export async function newTab({ profileId, target, url }) {
  const pid = safeId(profileId, 'profileId');
  getTargetPageOrThrow(target);
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
    const result = { profileId: pid, page, url: page.url(), created: true };
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
 * Close the page owned by a target.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {Object} opts.target - Resolved target handle owned by daemon
 * @returns {Object} close tab result
 */
export async function closeTab({ profileId, target }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  emit(pid, 'closeTab.start', { targetId: target.targetId });
  try {
    await page.close({ runBeforeUnload: false });
    const result = { profileId: pid, targetId: target.targetId, closed: true };
    emit(pid, 'closeTab.done', { targetId: target.targetId });
    return result;
  } catch (cause) {
    emit(pid, 'closeTab.error', { targetId: target.targetId, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_CLOSETAB_FAILED', details: { profileId: pid, targetId: target.targetId, reason: cause?.message }, cause });
  }
}

/**
 * List open tabs for the profile's resolved targets.
 *
 * The daemon resolves targets first; page runtime only reads each target's
 * internal page handle and never invents indices as external identity.
 *
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {Object[]} opts.targets - Resolved target handles
 * @returns {Object} list tabs result
 */
export async function listTabs({ profileId, targets }) {
  const pid = safeId(profileId, 'profileId');
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_target', profileId: pid } });
  }
  emit(pid, 'listTabs.start', {});
  try {
    const tabs = await Promise.all(targets.map(async (target) => ({
      target: target.targetId,
      page: target.pageId,
      url: target.page.url(),
      title: await target.page.title(),
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
 * Bring a target's page to front. The target is the stable external handle;
 * no mutable tab index is accepted.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {Object} opts.target - Resolved target handle owned by daemon
 * @returns {Object} switch result
 */
export async function switchTab({ profileId, target }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  emit(pid, 'switchTab.start', { targetId: target.targetId });
  try {
    await page.bringToFront();
    const result = { profileId: pid, targetId: target.targetId, url: page.url(), switched: true };
    emit(pid, 'switchTab.done', { targetId: target.targetId, url: result.url });
    return result;
  } catch (cause) {
    emit(pid, 'switchTab.error', { targetId: target.targetId, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SWITCHTAB_FAILED', details: { profileId: pid, targetId: target.targetId, reason: cause?.message }, cause });
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
 * @returns {Object} results: { profileId, opened: [{page,url}], screenshots: [{page,url,path,size}], errors: [] }
 */
export async function multiOpen({ profileId, target, urls, outDir = null, prefix = 'multi-open' }) {
  const pid = safeId(profileId, 'profileId');
  getTargetPageOrThrow(target);
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
      opened.push({ page, url: page.url() });
      let destPath = null;
      if (outDir) {
        const { join } = await import('node:path');
        const safe = String(i + 1).padStart(2, '0');
        destPath = join(outDir, `${prefix}-${safe}.png`);
      }
      const buffer = await page.screenshot({ fullPage: false, type: 'png', path: destPath || undefined });
      screenshots.push({ page, url: page.url(), size: buffer?.length ?? 0, path: destPath || null });
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
