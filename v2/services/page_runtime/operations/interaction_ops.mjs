// Interaction operations. truth_owner: page_runtime.
//
// Interaction: click, hover, type, scroll, upload, select.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit, resolveLocator } from './_page_helpers.mjs';

/**
 * Click an element.
 *
 * Uses .first() to avoid strict mode failure when selector matches multiple elements.
 * Scrolls element into view and waits for visibility before clicking.
 *
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.selector] - CSS selector
 * @param {string} [opts.text] - Text content to find and click
 * @param {string} [opts.button] - 'left'|'right'|'middle'
 * @returns {Object} click result
 */
export async function click({ profileId, selector, text, button = 'left' }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const { locator, hasSelector, hasText } = resolveLocator(page, selector, text);
  if (!locator) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  const allowedButtons = new Set(['left', 'right', 'middle']);
  const btn = allowedButtons.has(button) ? button : 'left';
  emit(pid, 'click.start', { selector, text, button: btn });
  try {
    // Use .first() to avoid strict mode failure on multiple matches
    // Scroll into view and wait for visibility before clicking
    const loc = locator.first();
    await loc.scrollIntoViewIfNeeded();
    await loc.waitFor({ state: 'visible', timeout: 10000 });
    // Camoufox can hang waiting for a navigation that may not occur.
    // noWaitAfter avoids the navigation wait; callers explicitly wait for
    // page state when needed.
    await loc.click({ button: btn, timeout: 10000, force: true, noWaitAfter: true });
    const result = { profileId: pid, clicked: true, selector: hasSelector ? selector : null, text: hasText ? text : null, button: btn };
    emit(pid, 'click.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'click.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_CLICK_FAILED', details: { profileId: pid, selector, text, reason: cause?.message }, cause });
  }
}

/**
 * Hover over an element.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.selector] - CSS selector
 * @param {string} [opts.text] - Text to find and hover
 * @returns {Object} hover result
 */
export async function hover({ profileId, selector, text }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  const { locator, hasSelector, hasText } = resolveLocator(page, selector, text);
  if (!locator) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  emit(pid, 'hover.start', { selector, text });
  try {
    await locator.hover({ timeout: 10000 });
    const result = { profileId: pid, hovered: true, selector: hasSelector ? selector : null, text: hasText ? text : null };
    emit(pid, 'hover.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'hover.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_HOVER_FAILED', details: { profileId: pid, selector, text, reason: cause?.message }, cause });
  }
}

/**
 * Type text into an element or focused element.
 *
 * Strategy:
 * 1. If selector provided: use locator.fill() which triggers 'input' events
 *    that Vue/React reactive inputs listen to.
 * 2. If no selector: use keyboard.type() at current focus.
 *
 * Note: keyboard.type() sends keydown/keypress/keyup events, not 'input' events.
 * For Vue/React inputs, fill() is the correct approach.
 *
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.text - Text to type
 * @param {string} [opts.selector] - Element selector (optional)
 * @param {number} [opts.delay] - Delay between keystrokes in ms
 * @returns {Object} type result
 */
export async function type({ profileId, text, selector, delay }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  if (!text || typeof text !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'text' } });
  const delayMs = typeof delay === 'number' && delay >= 0 ? delay : 0;
  emit(pid, 'type.start', { length: text.length, delay: delayMs, selector });
  try {
    if (selector) {
      // Use .first() to avoid strict mode failure on multiple matches
      const loc = page.locator(selector).first();
      await loc.scrollIntoViewIfNeeded();
      await loc.waitFor({ state: 'visible', timeout: 5000 });
      // fill() triggers 'input' events that Vue/React reactive inputs handle
      // This is the correct approach for Vue/React forms.
      await loc.fill(text);
    } else {
      // No selector: type at current focus using keyboard
      await page.keyboard.type(text, { delay: delayMs });
    }
    const result = { profileId: pid, typed: true, length: text.length, delay: delayMs, selector: selector || null };
    emit(pid, 'type.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'type.error', { length: text.length, selector, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_TYPE_FAILED', details: { profileId: pid, selector, reason: cause?.message }, cause });
  }
}


/**
 * Scroll the page by offset.
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
    // Protocol-level scroll: dispatch a real wheel input event, not a JS
    // window.scrollTo hack. Move the pointer into the viewport first so the
    // wheel event targets the scrolling region.
    const viewport = page.viewportSize() || { width: 800, height: 600 };
    const cx = Math.floor(viewport.width / 2);
    const cy = Math.floor(viewport.height / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(scrollX, scrollY);
    const result = { profileId: pid, scrolled: true, x: scrollX, y: scrollY };
    emit(pid, 'scroll.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'scroll.error', { x: scrollX, y: scrollY, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SCROLL_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
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
  if (!selector || typeof selector !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  if (!Array.isArray(files) || files.length === 0) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'files' } });
  emit(pid, 'upload.start', { selector, fileCount: files.length });
  try {
    await page.locator(selector).setInputFiles(files);
    const result = { profileId: pid, uploaded: true, selector, fileCount: files.length };
    emit(pid, 'upload.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'upload.error', { selector, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_UPLOAD_FAILED', details: { profileId: pid, selector, reason: cause?.message }, cause });
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
  if (!selector || typeof selector !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  if (!value || typeof value !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'value' } });
  emit(pid, 'select.start', { selector, value });
  try {
    await page.locator(selector).selectOption(value);
    const result = { profileId: pid, selected: true, selector, value };
    emit(pid, 'select.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'select.error', { selector, value, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SELECT_FAILED', details: { profileId: pid, selector, value, reason: cause?.message }, cause });
  }
}
