// Query operations. truth_owner: page_runtime.
//
// Query: screenshot, snapshot, getText, getPageInfo, findElements, getReadable.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit } from './_page_helpers.mjs';

/**
 * Take a screenshot.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {boolean} [opts.fullPage] - Capture full scrollable page
 * @param {string} [opts.path] - File path to save screenshot (optional)
 * @returns {Object} screenshot result with base64 data and saved path
 */
export async function screenshot({ profileId, fullPage = false, path: destPath }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  emit(pid, 'screenshot.start', { fullPage, path: destPath || null });
  try {
    const screenshotOpts = { fullPage, type: 'png' };
    if (destPath) screenshotOpts.path = destPath;
    const buffer = await page.screenshot(screenshotOpts);
    const base64 = buffer.toString('base64');
    const result = {
      profileId: pid,
      screenshot: true,
      format: 'png',
      size: buffer.length,
      data: base64,
      saved: destPath ? true : false,
      savedPath: destPath || null
    };
    emit(pid, 'screenshot.done', { size: buffer.length, saved: destPath ? true : false });
    return result;
  } catch (cause) {
    emit(pid, 'screenshot.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SCREENSHOT_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}


/**
 * Get DOM snapshot (full HTML).
 * @param {Object} opts
 * @param {string} opts.profileId
 * @returns {Object} snapshot result with HTML
 */
export async function snapshot({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  emit(pid, 'snapshot.start', {});
  try {
    const content = await page.content();
    const result = { profileId: pid, snapshot: true, url: page.url(), htmlLength: content.length, html: content };
    emit(pid, 'snapshot.done', { htmlLength: content.length });
    return result;
  } catch (cause) {
    emit(pid, 'snapshot.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SNAPSHOT_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Get text content of an element or the whole page.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.selector] - Element selector
 * @returns {Object} text result
 */
export async function getText({ profileId, selector }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  emit(pid, 'getText.start', { selector });
  try {
    let text;
    if (typeof selector === 'string' && selector.length > 0) {
      text = await page.locator(selector).textContent({ timeout: 10000 });
    } else {
      text = await page.evaluate(() => document.body?.innerText || '');
    }
    const result = { profileId: pid, text: text || '', length: (text || '').length };
    emit(pid, 'getText.done', { length: result.length });
    return result;
  } catch (cause) {
    emit(pid, 'getText.error', { selector, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_GETTEXT_FAILED', details: { profileId: pid, selector, reason: cause?.message }, cause });
  }
}

/**
 * Get page info (title, URL, dimensions, etc).
 * @param {Object} opts
 * @param {string} opts.profileId
 * @returns {Object} page info result
 */
export async function getPageInfo({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  emit(pid, 'getPageInfo.start', {});
  try {
    const info = await page.evaluate(() => ({
      title: document.title, url: location.href, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
      scrollX: window.scrollX, scrollY: window.scrollY, readyState: document.readyState,
    }));
    const result = { profileId: pid, ...info };
    emit(pid, 'getPageInfo.done', { title: info.title, url: info.url });
    return result;
  } catch (cause) {
    emit(pid, 'getPageInfo.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_GETPAGEINFO_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Find elements matching a selector or text.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.selector] - CSS selector
 * @param {string} [opts.text] - Text to search for
 * @returns {Object} elements result
 */
export async function findElements({ profileId, selector, text }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const hasSelector = typeof selector === 'string' && selector.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  if (!hasSelector && !hasText) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  emit(pid, 'findElements.start', { selector, text });
  try {
    const elements = await page.evaluate(({ sel, txt }) => {
      const results = [];
      let nodes;
      if (txt) {
        nodes = Array.from(document.querySelectorAll('*')).filter(el => el.textContent && el.textContent.includes(txt));
      } else {
        nodes = Array.from(document.querySelectorAll(sel));
      }
      for (const el of nodes.slice(0, 50)) {
        const rect = el.getBoundingClientRect();
        results.push({ tag: el.tagName.toLowerCase(), id: el.id || null,
          className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 100) : null,
          text: (el.textContent || '').trim().slice(0, 200), visible: rect.width > 0 && rect.height > 0,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height } });
      }
      return results;
    }, { sel: hasSelector ? selector : '', txt: hasText ? text : '' });
    const result = { profileId: pid, count: elements.length, elements };
    emit(pid, 'findElements.done', { count: elements.length });
    return result;
  } catch (cause) {
    emit(pid, 'findElements.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_FINDELEMENTS_FAILED', details: { profileId, selector, text, reason: cause?.message }, cause });
  }
}

/**
 * Get readable content (simplified article-like extraction).
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} [opts.maxLength] - Maximum text length
 * @returns {Object} readable text result
 */
export async function getReadable({ profileId, maxLength }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const max = typeof maxLength === 'number' && maxLength > 0 ? maxLength : 50000;
  emit(pid, 'getReadable.start', { maxLength: max });
  try {
    const result = await page.evaluate((maxLen) => {
      const removeTags = ['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'header'];
      for (const tag of removeTags) document.querySelectorAll(tag).forEach(el => el.remove());
      const article = document.querySelector('article') || document.querySelector('main') || document.body;
      const clone = article.cloneNode(true);
      clone.querySelectorAll('script,style,noscript,iframe,svg').forEach(el => el.remove());
      const text = (clone.textContent || '').trim();
      return text.length > maxLen ? text.slice(0, maxLen) + '\n... [truncated]' : text;
    }, max);
    const output = { profileId: pid, text: result, length: result.length };
    emit(pid, 'getReadable.done', { length: result.length });
    return output;
  } catch (cause) {
    emit(pid, 'getReadable.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_GETREADABLE_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}
