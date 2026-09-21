// Interaction operations. truth_owner: page_runtime.
//
// Interaction: click, hover, type, scroll, upload, select.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getTargetPageOrThrow, emit, resolveLocator } from './_page_helpers.mjs';

function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new CamoError({ code: 'E_IO_TIMEOUT', details: { reason: 'operation aborted' } });
}

async function awaitProtocol(operation, signal) {
  throwIfAborted(signal);
  if (!signal) return operation;
  return Promise.race([
    operation,
    new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

async function readLocatorBox(locator) {
  return locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
}

async function readViewportSize(page) {
  const viewport = page.viewportSize();
  if (viewport) return viewport;
  return page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
}

async function chooseVisibleLocator(page, locator, profileId, selector, text, failureCode) {
  const count = await locator.count();
  const viewport = await readViewportSize(page);
  let selected = null;
  let visibleSelected = null;
  let selectedArea = Number.POSITIVE_INFINITY;
  let visibleArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const box = await readLocatorBox(candidate);
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

async function moveLocatorIntoViewport(page, locator, profileId, selector, text, failureCode, signal) {
  const viewport = await readViewportSize(page);
  const margin = 8;
  const verticalMargin = Math.min(64, Math.max(margin, Math.round(viewport.height * 0.1)));
  let pointerAnchored = false;

  for (let wheelAttempt = 0; wheelAttempt < 12; wheelAttempt += 1) {
    throwIfAborted(signal);
    const box = await readLocatorBox(locator);
    if (!box) {
      throw new CamoError({
        code: failureCode,
        details: { profileId, selector, text, reason: 'element not visible or not in DOM' },
      });
    }

    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    const activeVerticalMargin = pointerAnchored ? verticalMargin : margin;
    const insideViewport = box.x >= 0 && box.x + box.width <= viewport.width
      && box.y >= 0 && box.y + box.height <= viewport.height;
    if (!pointerAnchored && insideViewport) return { x: cx, y: cy };

    const inside = box.x >= margin && box.x + box.width <= viewport.width - margin
      && box.y >= activeVerticalMargin
      && box.y + box.height <= viewport.height - activeVerticalMargin;
    if (inside) return { x: cx, y: cy };


    const wheelX = box.x < margin || box.x + box.width > viewport.width - margin
      ? (cx < viewport.width / 2
        ? Math.max(-120, cx - viewport.width / 2)
        : Math.min(120, cx - viewport.width / 2))
      : 0;
    const wheelY = box.y < activeVerticalMargin
      || box.y + box.height > viewport.height - activeVerticalMargin
      ? (cy < viewport.height / 2
        ? Math.max(-120, cy - viewport.height / 2)
        : Math.min(120, cy - viewport.height / 2))
      : 0;
    if (!pointerAnchored) {
      await awaitProtocol(page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2)), signal);
      pointerAnchored = true;
    }
    await awaitProtocol(page.mouse.wheel(wheelX, wheelY), signal);

    let previousBox = null;
    let settledBox = null;
    for (let settleAttempt = 0; settleAttempt < 12; settleAttempt += 1) {
      // Playwright acknowledges wheel dispatch before scrolling finishes.
      // Require two stable geometry samples before clicking or redispatching.
      await page.waitForTimeout(32);
      const currentBox = await readLocatorBox(locator);
      if (!currentBox) {
        throw new CamoError({
          code: failureCode,
          details: { profileId, selector, text, reason: 'element not visible or not in DOM' },
        });
      }
      if (previousBox
        && Math.abs(currentBox.x - previousBox.x) < 0.5
        && Math.abs(currentBox.y - previousBox.y) < 0.5
        && Math.abs(currentBox.width - previousBox.width) < 0.5
        && Math.abs(currentBox.height - previousBox.height) < 0.5) {
        settledBox = currentBox;
        break;
      }
      previousBox = currentBox;
    }
    if (!settledBox) {
      throw new CamoError({
        code: failureCode,
        details: { profileId, selector, text, reason: 'element did not settle after protocol wheel input' },
      });
    }

    const settledX = Math.round(settledBox.x + settledBox.width / 2);
    const settledY = Math.round(settledBox.y + settledBox.height / 2);
    const settledInside = settledBox.x >= margin
      && settledBox.x + settledBox.width <= viewport.width - margin
      && settledBox.y >= verticalMargin
      && settledBox.y + settledBox.height <= viewport.height - verticalMargin;
    if (settledInside) return { x: settledX, y: settledY };
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
 * 1. Get element center via read-only getBoundingClientRect()
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
export async function click({ profileId, target, selector, text, button = 'left', dialogAction = null, dialogText = null }, signal) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const { locator, hasSelector, hasText } = resolveLocator(page, selector, text);
  if (!locator) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  const allowedButtons = new Set(['left', 'right', 'middle']);
  const btn = allowedButtons.has(button) ? button : 'left';
  const allowedDialogActions = new Set(['accept', 'dismiss']);
  if (dialogAction !== null && !allowedDialogActions.has(dialogAction)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'dialogAction', value: dialogAction, allowed: [...allowedDialogActions] },
    });
  }
  if (dialogText !== null && typeof dialogText !== 'string') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'dialogText', value: dialogText } });
  }
  if (dialogText !== null && dialogAction !== 'accept') {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'dialogText', reason: 'dialogText requires dialogAction=accept' },
    });
  }
  emit(pid, 'click.start', { selector, text, button: btn });

  let dialogRecord = null;
  let dialogHandler = null;
  try {
    if (dialogAction !== null) {
      dialogHandler = async (dialog) => {
        dialogRecord = {
          type: dialog.type(),
          message: dialog.message(),
          defaultValue: dialog.defaultValue(),
          action: dialogAction,
        };
        if (dialogAction === 'accept') await dialog.accept(dialogText ?? undefined);
        else await dialog.dismiss();
      };
      page.on('dialog', dialogHandler);
    }
    const loc = await chooseVisibleLocator(page, locator, pid, selector, text, 'E_BROWSER_CLICK_FAILED');
    const point = await moveLocatorIntoViewport(page, loc, pid, selector, text, 'E_BROWSER_CLICK_FAILED', signal);
    await awaitProtocol(page.mouse.move(point.x, point.y), signal);
    await awaitProtocol(page.mouse.down({ button: btn }), signal);
    await awaitProtocol(page.mouse.up({ button: btn }), signal);

    const result = {
      profileId: pid,
      targetId: target.targetId,
      clicked: true,
      selector: hasSelector ? selector : null,
      text: hasText ? text : null,
      button: btn,
      dialog: dialogRecord,
    };
    emit(pid, 'click.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'click.error', { selector, text, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_CLICK_FAILED', details: { profileId: pid, selector, text, reason: cause?.details?.reason || cause?.message }, cause });
  } finally {
    if (dialogHandler) page.off('dialog', dialogHandler);
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
export async function hover({ profileId, target, selector, text }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const { locator, hasSelector, hasText } = resolveLocator(page, selector, text);
  if (!locator) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector or text' } });
  emit(pid, 'hover.start', { selector, text });
  try {
    const loc = await chooseVisibleLocator(page, locator, pid, selector, text, 'E_BROWSER_HOVER_FAILED');
    const point = await moveLocatorIntoViewport(page, loc, pid, selector, text, 'E_BROWSER_HOVER_FAILED');
    await page.mouse.move(point.x, point.y);
    const result = {
      profileId: pid,
      targetId: target.targetId,
      hovered: true,
      selector: hasSelector ? selector : null,
      text: hasText ? text : null,
    };
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
export async function type({ profileId, target, text, selector, delay }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
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
    const result = {
      profileId: pid,
      targetId: target.targetId,
      typed: true,
      length: text.length,
      delay: delayMs,
      selector: selector || null,
    };
    emit(pid, 'type.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'type.error', { length: text.length, selector, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_TYPE_FAILED',
      details: { profileId: pid, selector, reason: cause?.message },
      cause,
    });
  }
}

/**
 * Press a real keyboard key through the browser protocol.
 *
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.action - only 'press' is supported
 * @param {string} opts.key - allowlisted key name
 * @returns {Object} keyboard result
 */
export async function keyboard({ profileId, target, action, key }, signal) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const allowedActions = new Set(['press']);
  const allowedKeys = new Set([
    'Enter',
    'Escape',
    'Tab',
    'ArrowUp',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
  ]);
  if (!allowedActions.has(action)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'action', value: action, allowed: [...allowedActions] },
    });
  }
  if (!allowedKeys.has(key)) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'key', value: key, allowed: [...allowedKeys] },
    });
  }
  emit(pid, 'keyboard.start', { action, key });
  try {
    await awaitProtocol(page.keyboard.press(key), signal);
    const result = {
      profileId: pid,
      targetId: target.targetId,
      pressed: true,
      action,
      key,
    };
    emit(pid, 'keyboard.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'keyboard.error', { action, key, error: cause?.message });
    throw new CamoError({
      code: 'E_BROWSER_KEYBOARD_FAILED',
      details: { profileId: pid, action, key, reason: cause?.details?.reason || cause?.message },
      cause,
    });
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
export async function scroll({ profileId, target, x = 0, y = 0, atX = null, atY = null }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const scrollX = typeof x === 'number' ? x : 0;
  const scrollY = typeof y === 'number' ? y : 0;
  emit(pid, 'scroll.start', { x: scrollX, y: scrollY });
  try {
    // Protocol-level scroll: dispatch a real wheel input event, not a JS
    // window.scrollTo hack. Move the pointer into the viewport first so the
    // wheel event targets the scrolling region.
    const viewport = await readViewportSize(page);
    const cx = Number.isFinite(atX) ? Math.max(0, Math.min(viewport.width - 1, Math.floor(atX))) : Math.floor(viewport.width / 2);
    const cy = Number.isFinite(atY) ? Math.max(0, Math.min(viewport.height - 1, Math.floor(atY))) : Math.floor(viewport.height / 2);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(scrollX, scrollY);
    const result = { profileId: pid, targetId: target.targetId, scrolled: true, x: scrollX, y: scrollY, atX: cx, atY: cy };
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
export async function upload({ profileId, target, selector, files }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  if (!selector || typeof selector !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  if (!Array.isArray(files) || files.length === 0) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'files' } });
  emit(pid, 'upload.start', { selector, fileCount: files.length });
  try {
    await page.locator(selector).setInputFiles(files);
    const result = { profileId: pid, targetId: target.targetId, uploaded: true, selector, fileCount: files.length };
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
export async function select({ profileId, target, selector, value }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  if (!selector || typeof selector !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'selector' } });
  if (!value || typeof value !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'value' } });
  emit(pid, 'select.start', { selector, value });
  try {
    await page.locator(selector).selectOption(value);
    const result = { profileId: pid, targetId: target.targetId, selected: true, selector, value };
    emit(pid, 'select.done', result);
    return result;
  } catch (cause) {
    emit(pid, 'select.error', { selector, value, error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_SELECT_FAILED', details: { profileId: pid, selector, value, reason: cause?.message }, cause });
  }
}
