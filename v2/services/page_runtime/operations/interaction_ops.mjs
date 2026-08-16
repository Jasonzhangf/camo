// Interaction operations. truth_owner: page_runtime.
//
// Interaction: click, hover, type, scroll, upload, select.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit, resolveLocator } from './_page_helpers.mjs';

async function chooseVisibleLocator(page, locator, profileId, selector, text, failureCode) {
  const count = await locator.count();
  const viewport = page.viewportSize?.() || null;
  let selected = null;
  let visibleSelected = null;
  let selectedArea = Number.POSITIVE_INFINITY;
  let visibleArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const box = await candidate.boundingBox();
    if (!box || box.width <= 0 || box.height <= 0) continue;
    if (viewport && (
      box.x + box.width > 0
      && box.y + box.height > 0
      && box.x < viewport.width
      && box.y < viewport.height
    )) {
      const area = box.width * box.height;
      if (area < visibleArea) {
        visibleSelected = candidate;
        visibleArea = area;
      }
    }
    const area = box.width * box.height;
    if (area < selectedArea) {
      selected = candidate;
      selectedArea = area;
    }
  }
  selected = visibleSelected || selected;
  if (!selected) {
    throw new CamoError({
      code: failureCode,
      details: { profileId, selector, text, reason: 'no visible target matched' },
    });
  }
  return selected;
}

async function moveLocatorIntoViewport(page, locator, profileId, selector, text, failureCode) {
  const viewport = page.viewportSize() || { width: 800, height: 600 };
  const margin = 8;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const box = await locator.boundingBox();
    if (!box) {
      throw new CamoError({
        code: failureCode,
        details: { profileId, selector, text, reason: 'element not visible or not in DOM' },
      });
    }

    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    const inside = cx >= margin && cx <= viewport.width - margin
      && cy >= margin && cy <= viewport.height - margin;
    if (inside) return { x: cx, y: cy };

    const wheelX = cx < margin
      ? Math.min(-120, cx - margin)
      : (cx > viewport.width - margin ? Math.max(120, cx - (viewport.width - margin)) : 0);
    const wheelY = cy < margin
      ? Math.min(-120, cy - margin)
      : (cy > viewport.height - margin ? Math.max(120, cy - (viewport.height - margin)) : 0);
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2));
    await page.mouse.wheel(wheelX, wheelY);
  }

  throw new CamoError({
    code: failureCode,
    details: { profileId, selector, text, reason: 'element did not enter viewport after protocol wheel input' },
  });
}

/**
 * Click an element using protocol-level mouse simulation.
 *
 * Strategy:
 * 1. Get element center via locator.boundingBox()
 * 2. Move it into view with protocol wheel events when necessary
 * 3. page.mouse.move() -> down() -> up() at element center
 *    This bypasses Playwright's actionability layer completely.
 *    No JS injection, no locator.click() actionability wait.
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
    const loc = await chooseVisibleLocator(page, locator, pid, selector, text, 'E_BROWSER_CLICK_FAILED');
    const point = await moveLocatorIntoViewport(page, loc, pid, selector, text, 'E_BROWSER_CLICK_FAILED');
    await page.mouse.move(point.x, point.y);
    await page.mouse.down({ button: btn });
    await page.mouse.up({ button: btn });

    const result = { profileId: pid, clicked: true, selector: hasSelector ? selector : null, text: hasText ? text : null, button: btn };
    emit(pid, 'click.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'click.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_CLICK_FAILED', details: { profileId: pid, selector, text, reason: cause?.details?.reason || cause?.message }, cause });
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
    const loc = await chooseVisibleLocator(page, locator, pid, selector, text, 'E_BROWSER_HOVER_FAILED');
    const point = await moveLocatorIntoViewport(page, loc, pid, selector, text, 'E_BROWSER_HOVER_FAILED');
    await page.mouse.move(point.x, point.y);
    const result = { profileId: pid, hovered: true, selector: hasSelector ? selector : null, text: hasText ? text : null };
    emit(pid, 'hover.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'hover.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_HOVER_FAILED', details: { profileId: pid, selector, text, reason: cause?.message }, cause });
  }
}

/**
 * Type text using protocol-level mouse and keyboard simulation.
 *
 * When a selector is provided, the element is focused with a real mouse
 * move/down/up sequence, then real keyboard events are sent through the
 * browser protocol. No DOM value assignment or evaluate-based input is used.
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
      const loc = await chooseVisibleLocator(page, page.locator(selector), pid, selector, null, 'E_BROWSER_TYPE_FAILED');
      const point = await moveLocatorIntoViewport(page, loc, pid, selector, null, 'E_BROWSER_TYPE_FAILED');
      await page.mouse.move(point.x, point.y);
      await page.mouse.down({ button: 'left' });
      await page.mouse.up({ button: 'left' });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
    }
    await page.keyboard.type(text, { delay: delayMs });
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
export async function scroll({ profileId, x = 0, y = 0, atX = null, atY = null }) {
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
    const cx = Number.isFinite(atX) ? Math.max(0, Math.min(viewport.width - 1, Math.floor(atX))) : Math.floor(viewport.width / 2);
    const cy = Number.isFinite(atY) ? Math.max(0, Math.min(viewport.height - 1, Math.floor(atY))) : Math.floor(viewport.height / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(scrollX, scrollY);
    const result = { profileId: pid, scrolled: true, x: scrollX, y: scrollY, atX: cx, atY: cy };
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
