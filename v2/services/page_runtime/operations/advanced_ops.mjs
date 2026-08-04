// Advanced operations. truth_owner: page_runtime.
//
// Advanced: evaluate, scrollAndCollect, fetch.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit } from './_page_helpers.mjs';

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
  if (!script || typeof script !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'script' } });
  emit(pid, 'evaluate.start', { scriptLength: script.length });
  try {
    const result = await page.evaluate(script);
    const output = { profileId: pid, evaluated: true, result };
    emit(pid, 'evaluate.done', { resultType: typeof result });
    return output;
  } catch (cause) {
    emit(pid, 'evaluate.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_EVALUATE_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}

/**
 * Scroll and collect visible text content.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} [opts.scrollCount] - Number of scrolls (default 5)
 * @param {number} [opts.scrollDelay] - Delay between scrolls in ms (default 1000)
 * @returns {Object} scroll and collect result
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
          for (const el of document.querySelectorAll('*')) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.top < window.innerHeight) {
              const text = (el.textContent || '').trim();
              if (text && text.length > 20) visible.push({ tag: el.tagName.toLowerCase(), text: text.slice(0, 500) });
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
 * Fetch/download content from a URL using page context.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} opts.url - URL to fetch
 * @param {number} [opts.timeout] - Request timeout in ms (default 30000)
 * @returns {Object} fetch result
 */
export async function fetch({ profileId, url, timeout }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
  if (!url || typeof url !== 'string') throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'url' } });
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
