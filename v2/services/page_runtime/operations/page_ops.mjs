// Page operations. Single truth_owner for page_runtime operations.
//
// This module provides the actual Playwright page operations that are
// called by input_pipeline. It bridges browser_service to Playwright Page.
//
// Hard guards:
//   - All operations require a valid browser page.
//   - Operations throw CamoError with appropriate codes on failure.
//   - No v1 imports.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { getPage } from '../../browser_service/internal/camoufox_bridge.mjs';
import { append as appendProgress } from '../../progress_event/log.mjs';

function safeId(id, field) {
  const v = String(id || '').trim();
  if (!v) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field } });
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field, value: v, reason: 'must match [a-zA-Z0-9._-]+' } });
  }
  return v;
}

function getPageOrThrow(profileId) {
  const pid = safeId(profileId, 'profileId');
  const page = getPage(pid);
  if (!page) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'page', profileId: pid } });
  }
  return page;
}

function emit(profileId, type, payload) {
  appendProgress({ event: type, source: 'page_ops', profileId, payload, ts: new Date().toISOString() });
}

/**
 * Navigate to a URL.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.url - URL to navigate to
 * @param {string} [opts.waitUntil] - 'load' | 'domcontentloaded' | 'networkidle' | 'commit'
 * @returns {Object} navigation result
 */
export async function goto({ profileId, url, waitUntil = 'load' }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  if (!url || typeof url !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'url' } });
  }
  if (!/^https?:\/\//.test(url)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'url', value: url, reason: 'must start with http:// or https://' } });
  }
  
  emit(pid, 'goto.start', { url, waitUntil });
  
  const allowedWaitUntil = new Set(['load', 'domcontentloaded', 'networkidle', 'commit']);
  const waitVal = allowedWaitUntil.has(waitUntil) ? waitUntil : 'load';
  
  try {
    const response = await page.goto(url, { waitUntil: waitVal, timeout: 30000 });
    const result = {
      profileId: pid,
      url,
      statusCode: response?.status() ?? null,
      ok: response?.ok() ?? false,
      navigated: true,
      finalUrl: page.url(),
    };
    emit(pid, 'goto.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'goto.error', { url, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_NAVIGATION_FAILED',
      details: { profileId: pid, url, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Click an element.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.selector] - CSS selector
 * @param {string} [opts.text] - Text content to find and click
 * @param {string} [opts.button] - 'left' | 'right' | 'middle'
 * @returns {Object} click result
 */
export async function click({ profileId, selector, text, button = 'left' }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  const hasSelector = typeof selector === 'string' && selector.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  
  if (!hasSelector && !hasText) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  }
  
  const allowedButtons = new Set(['left', 'right', 'middle']);
  const btn = allowedButtons.has(button) ? button : 'left';
  
  emit(pid, 'click.start', { selector, text, button: btn });
  
  try {
    const locator = hasText 
      ? page.getByText(text, { exact: false })
      : page.locator(selector);
    
    await locator.click({ button: btn, timeout: 10000 });
    
    const result = {
      profileId: pid,
      clicked: true,
      selector: hasSelector ? selector : null,
      text: hasText ? text : null,
      button: btn,
    };
    emit(pid, 'click.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'click.error', { selector, text, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_CLICK_FAILED',
      details: { profileId: pid, selector, text, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Type text.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.text - Text to type
 * @param {number} [opts.delay] - Delay between keystrokes in ms
 * @returns {Object} type result
 */
export async function type({ profileId, text, delay }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  if (!text || typeof text !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'text' } });
  }
  
  const delayMs = typeof delay === 'number' && delay >= 0 ? delay : 0;
  
  emit(pid, 'type.start', { length: text.length, delay: delayMs });
  
  try {
    await page.keyboard.type(text, { delay: delayMs });
    
    const result = {
      profileId: pid,
      typed: true,
      length: text.length,
      delay: delayMs,
    };
    emit(pid, 'type.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'type.error', { length: text.length, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_TYPE_FAILED',
      details: { profileId: pid, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Scroll the page.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} [opts.x] - X offset
 * @param {number} [opts.y] - Y offset
 * @returns {Object} scroll result
 */
export async function scroll({ profileId, x = 0, y = 0 }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  const scrollX = typeof x === 'number' ? x : 0;
  const scrollY = typeof y === 'number' ? y : 0;
  
  emit(pid, 'scroll.start', { x: scrollX, y: scrollY });
  
  try {
    await page.evaluate(({ scrollX, scrollY }) => {
      window.scrollTo({ top: scrollY, left: scrollX, behavior: 'smooth' });
    }, { scrollX, scrollY });
    
    const result = {
      profileId: pid,
      scrolled: true,
      x: scrollX,
      y: scrollY,
    };
    emit(pid, 'scroll.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'scroll.error', { x: scrollX, y: scrollY, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_SCROLL_FAILED',
      details: { profileId: pid, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Take a screenshot.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {boolean} [opts.fullPage] - Capture full scrollable page
 * @returns {Object} screenshot result with base64 data
 */
export async function screenshot({ profileId, fullPage = false }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  emit(pid, 'screenshot.start', { fullPage });
  
  try {
    const buffer = await page.screenshot({ fullPage, type: 'png' });
    const base64 = buffer.toString('base64');
    
    const result = {
      profileId: pid,
      screenshot: true,
      format: 'png',
      size: buffer.length,
      data: base64,
    };
    emit(pid, 'screenshot.done', { size: buffer.length });
    return result;
  } catch (cause) {
    emit(pid, 'screenshot.error', { error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_SCREENSHOT_FAILED',
      details: { profileId: pid, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Get DOM snapshot.
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
    
    const result = {
      profileId: pid,
      snapshot: true,
      url: page.url(),
      htmlLength: content.length,
      html: content,
    };
    emit(pid, 'snapshot.done', { htmlLength: content.length });
    return result;
  } catch (cause) {
    emit(pid, 'snapshot.error', { error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_SNAPSHOT_FAILED',
      details: { profileId: pid, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Wait for a duration.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} [opts.ms] - Milliseconds to wait
 * @returns {Object} wait result
 */
export async function wait({ profileId, ms = 1000 }) {
  const pid = safeId(profileId, 'profileId');
  const waitMs = typeof ms === 'number' && ms > 0 ? ms : 1000;
  
  emit(pid, 'wait.start', { ms: waitMs });
  
  await new Promise(resolve => setTimeout(resolve, waitMs));
  
  const result = {
    profileId: pid,
    waited: true,
    ms: waitMs,
  };
  emit(pid, 'wait.done', result);
  return result;
}

/**
 * Evaluate JavaScript in the page context.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.script - JavaScript code to execute
 * @returns {Object} evaluation result
 */
export async function evaluate({ profileId, script }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  if (!script || typeof script !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'script' } });
  }
  
  emit(pid, 'evaluate.start', { scriptLength: script.length });
  
  try {
    const result = await page.evaluate(script);
    
    const output = {
      profileId: pid,
      evaluated: true,
      result,
    };
    emit(pid, 'evaluate.done', { resultType: typeof result });
    return output;
  } catch (cause) {
    emit(pid, 'evaluate.error', { error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_EVALUATE_FAILED',
      details: { profileId: pid, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Upload files to a file input.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.selector - File input selector
 * @param {string[]} opts.files - Array of file paths
 * @returns {Object} upload result
 */
export async function upload({ profileId, selector, files }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  if (!selector || typeof selector !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'files' } });
  }
  
  emit(pid, 'upload.start', { selector, fileCount: files.length });
  
  try {
    const locator = page.locator(selector);
    await locator.setInputFiles(files);
    
    const result = {
      profileId: pid,
      uploaded: true,
      selector,
      fileCount: files.length,
    };
    emit(pid, 'upload.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'upload.error', { selector, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_UPLOAD_FAILED',
      details: { profileId: pid, selector, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Select option in a dropdown.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.selector - Select element selector
 * @param {string} opts.value - Value to select
 * @returns {Object} select result
 */
export async function select({ profileId, selector, value }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  
  if (!selector || typeof selector !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  }
  if (!value || typeof value !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'value' } });
  }
  
  emit(pid, 'select.start', { selector, value });
  
  try {
    const locator = page.locator(selector);
    await locator.selectOption(value);
    
    const result = {
      profileId: pid,
      selected: true,
      selector,
      value,
    };
    emit(pid, 'select.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'select.error', { selector, value, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_SELECT_FAILED',
      details: { profileId: pid, selector, value, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Hover over an element.
 */
export async function hover({ profileId, selector, text }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const hasSelector = typeof selector === 'string' && selector.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  if (!hasSelector && !hasText) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  }
  emit(pid, 'hover.start', { selector, text });
  try {
    const locator = hasText ? page.getByText(text, { exact: false }) : page.locator(selector);
    await locator.hover({ timeout: 10000 });
    const result = { profileId: pid, hovered: true, selector: selector || null, text: text || null };
    emit(pid, 'hover.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'hover.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_HOVER_FAILED', details: { profileId: pid, selector, text, reason: cause?.message }, cause });
  }
}

/**
 * Get text content of an element or the whole page.
 */
export async function getText({ profileId, selector }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  emit(pid, 'getText.start', { selector });
  try {
    let text;
    if (typeof selector === 'string' && selector.length > 0) {
      const locator = page.locator(selector);
      text = await locator.textContent({ timeout: 10000 });
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
 */
export async function getPageInfo({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  emit(pid, 'getPageInfo.start', {});
  try {
    const info = await page.evaluate(() => ({
      title: document.title,
      url: location.href,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      readyState: document.readyState,
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
 * Find elements matching a selector.
 */
export async function findElements({ profileId, selector, text }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const hasSelector = typeof selector === 'string' && selector.length > 0;
  const hasText = typeof text === 'string' && text.length > 0;
  if (!hasSelector && !hasText) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  }
  emit(pid, 'findElements.start', { selector, text });
  try {
    const elements = await page.evaluate(({ sel, txt }) => {
      const results = [];
      let nodes;
      if (txt) {
        const all = document.querySelectorAll('*');
        nodes = Array.from(all).filter(el => el.textContent && el.textContent.includes(txt));
      } else {
        nodes = Array.from(document.querySelectorAll(sel));
      }
      for (const el of nodes.slice(0, 50)) {
        const rect = el.getBoundingClientRect();
        results.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: (el.className && typeof el.className === 'string') ? el.className.slice(0, 100) : null,
          text: (el.textContent || '').trim().slice(0, 200),
          visible: rect.width > 0 && rect.height > 0,
          rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        });
      }
      return results;
    }, { sel: hasSelector ? selector : '', txt: hasText ? text : '' });
    const result = { profileId: pid, count: elements.length, elements };
    emit(pid, 'findElements.done', { count: elements.length });
    return result;
  } catch (cause) {
    emit(pid, 'findElements.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_FINDELEMENTS_FAILED', details: { profileId: pid, selector, text, reason: cause?.message }, cause });
  }
}

/**
 * Get readable content (simplified article-like extraction).
 */
export async function getReadable({ profileId, maxLength }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const max = typeof maxLength === 'number' && maxLength > 0 ? maxLength : 50000;
  emit(pid, 'getReadable.start', { maxLength: max });
  try {
    const result = await page.evaluate((maxLen) => {
      const removeTags = ['script', 'style', 'noscript', 'iframe', 'svg', 'nav', 'footer', 'header'];
      for (const tag of removeTags) {
        document.querySelectorAll(tag).forEach(el => el.remove());
      }
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

/**
 * Create a new tab.
 */
export async function newTab({ profileId, url }) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = await import('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
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
 */
export async function closeTab({ profileId, tabId }) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = await import('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
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
 */
export async function listTabs({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = await import('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  emit(pid, 'listTabs.start', {});
  try {
    const pages = record.context.pages();
    const tabs = pages.map((p, i) => ({
      tabId: i,
      url: p.url(),
      title: p._title || '',
    }));
    const result = { profileId: pid, count: tabs.length, tabs };
    emit(pid, 'listTabs.done', { count: tabs.length });
    return result;
  } catch (cause) {
    emit(pid, 'listTabs.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_LISTTABS_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Get cookies for the current context.
 */
export async function getCookies({ profileId }) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = await import('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
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
 */
export async function setCookies({ profileId, cookies }) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = await import('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  if (!Array.isArray(cookies) || cookies.length === 0) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'cookies' } });
  }
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
 */
export async function setUserAgent({ profileId, userAgent }) {
  const pid = safeId(profileId, 'profileId');
  const { getBrowser } = await import('../../browser_service/internal/camoufox_bridge.mjs');
  const record = getBrowser(pid);
  if (!record) throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser', profileId: pid } });
  if (!userAgent || typeof userAgent !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'userAgent' } });
  }
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

/**
 * Wait for DOM to be stable (no mutations for a period).
 */
export async function waitForDomStable({ profileId, timeout, pollInterval }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const t = typeof timeout === 'number' && timeout > 0 ? timeout : 5000;
  const poll = typeof pollInterval === 'number' && pollInterval > 0 ? pollInterval : 500;
  emit(pid, 'waitForDomStable.start', { timeout: t, pollInterval: poll });
  try {
    const result = await page.evaluate(({ timeoutMs, pollMs }) => {
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + timeoutMs;
        let lastHtml = document.body?.innerHTML || '';
        function check() {
          if (Date.now() > deadline) {
            resolve({ stable: false, reason: 'timeout', elapsed: timeoutMs });
            return;
          }
          const current = document.body?.innerHTML || '';
          if (current === lastHtml) {
            resolve({ stable: true, elapsed: Date.now() - (deadline - timeoutMs) });
          } else {
            lastHtml = current;
            setTimeout(check, pollMs);
          }
        }
        setTimeout(check, pollMs);
      });
    }, { timeoutMs: t, pollMs: poll });
    const output = { profileId: pid, ...result };
    emit(pid, 'waitForDomStable.done', { stable: result.stable });
    return output;
  } catch (cause) {
    emit(pid, 'waitForDomStable.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_WAITFORDOMSTABLE_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Scroll and collect visible text content.
 */
export async function scrollAndCollect({ profileId, scrollCount, scrollDelay }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const count = typeof scrollCount === 'number' && scrollCount > 0 ? scrollCount : 5;
  const delay = typeof scrollDelay === 'number' && scrollDelay > 0 ? scrollDelay : 1000;
  emit(pid, 'scrollAndCollect.start', { scrollCount: count, scrollDelay: delay });
  try {
    const collected = await page.evaluate(({ maxScrolls, delayMs }) => {
      return new Promise((resolve) => {
        const texts = [];
        let scrolls = 0;
        function scrollAndCollect() {
          if (scrolls >= maxScrolls) {
            resolve({ collected: texts, scrolls, totalChars: texts.join('\n').length });
            return;
          }
          const visible = [];
          const all = document.querySelectorAll('*');
          for (const el of all) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
              const text = (el.textContent || '').trim();
              if (text && text.length > 20) {
                visible.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 500) });
              }
            }
          }
          if (visible.length > 0) texts.push(...visible);
          scrolls++;
          window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
          setTimeout(scrollAndCollect, delayMs);
        }
        scrollAndCollect();
      });
    }, { maxScrolls: count, delayMs: delay });
    const output = { profileId: pid, ...collected };
    emit(pid, 'scrollAndCollect.done', { scrolls: collected.scrolls, items: collected.collected?.length });
    return output;
  } catch (cause) {
    emit(pid, 'scrollAndCollect.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SCROLLANDCOLLECT_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Fetch/download a file from a URL.
 */
export async function fetch({ profileId, url, timeout }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  if (!url || typeof url !== 'string') {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'url' } });
  }
  const t = typeof timeout === 'number' && timeout > 0 ? timeout : 30000;
  emit(pid, 'fetch.start', { url, timeout: t });
  try {
    const result = await page.evaluate(async ({ fetchUrl, timeoutMs }) => {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(fetchUrl, { signal: controller.signal });
        clearTimeout(id);
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, contentType: resp.headers.get('content-type') || '', bodyLength: text.length, body: text.slice(0, 50000) };
      } catch (e) {
        clearTimeout(id);
        return { ok: false, error: e.message };
      }
    }, { fetchUrl: url, timeoutMs: t });
    const output = { profileId: pid, url, ...result };
    emit(pid, 'fetch.done', { ok: result.ok, status: result.status });
    return output;
  } catch (cause) {
    emit(pid, 'fetch.error', { url, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_FETCH_FAILED', details: { profileId: pid, url, reason: cause?.message }, cause });
  }
}
