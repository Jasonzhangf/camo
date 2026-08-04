// Configuration operations. truth_owner: page_runtime.
//
// Config: getCookies, setCookies, setUserAgent, setViewport.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit } from './_page_helpers.mjs';

let _bridge = null;
async function getBridge() {
  if (!_bridge) _bridge = await import('../../browser_service/internal/camoufox_bridge.mjs');
  return _bridge;
}

/**
 * Get cookies for the current context.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @returns {Object} cookies result
 */
export async function getCookies({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'getCookies.start', {});
  try {
    const cookies = await record.context.cookies();
    const result = { profileId: pid, count: cookies.length, cookies };
    emit(pid, 'getCookies.done', { count: cookies.length });
    return result;
  } catch (cause) {
    emit(pid, 'getCookies.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_GETCOOKIES_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Set cookies for the current context.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {Object[]} opts.cookies - Array of cookie objects
 * @returns {Object} set cookies result
 */
export async function setCookies({ profileId, cookies }) {
  const pid = safeId(profileId, 'profileId');
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  if (!Array.isArray(cookies) || cookies.length === 0) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'cookies' } });
  emit(pid, 'setCookies.start', { count: cookies.length });
  try {
    await record.context.addCookies(cookies);
    const result = { profileId: pid, count: cookies.length, set: true };
    emit(pid, 'setCookies.done', { count: cookies.length });
    return result;
  } catch (cause) {
    emit(pid, 'setCookies.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SETCOOKIES_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Set user agent for the current context.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.userAgent - User agent string
 * @returns {Object} set user agent result
 */
export async function setUserAgent({ profileId, userAgent }) {
  const pid = safeId(profileId, 'profileId');
  const bridge = await getBridge();
  const record = bridge.getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  if (!userAgent || typeof userAgent !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'userAgent' } });
  emit(pid, 'setUserAgent.start', { userAgent: userAgent.slice(0, 80) });
  try {
    await record.context.setExtraHTTPHeaders({ 'User-Agent': userAgent });
    await record.page.setUserAgent(userAgent);
    const result = { profileId: pid, userAgent, set: true };
    emit(pid, 'setUserAgent.done', {});
    return result;
  } catch (cause) {
    emit(pid, 'setUserAgent.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SETUSERAGENT_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Set viewport size.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} opts.width - Viewport width
 * @param {number} opts.height - Viewport height
 * @returns {Object} set viewport result
 */
export async function setViewport({ profileId, width, height }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const w = typeof width === 'number' && width > 0 ? width : 1280;
  const h = typeof height === 'number' && height > 0 ? height : 800;
  emit(pid, 'setViewport.start', { width: w, height: h });
  try {
    await page.setViewportSize({ width: w, height: h });
    const result = { profileId: pid, width: w, height: h, set: true };
    emit(pid, 'setViewport.done', { width: w, height: h });
    return result;
  } catch (cause) {
    emit(pid, 'setViewport.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SETVIEWPORT_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}
