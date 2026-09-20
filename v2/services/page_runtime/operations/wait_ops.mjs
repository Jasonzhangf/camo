// Wait operations. truth_owner: page_runtime.
//
// Wait: wait, waitForDomStable.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getTargetPageOrThrow, emit } from './_page_helpers.mjs';

/**
 * Wait for a duration.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {string} [opts.for_] - Condition: load, domcontentloaded, networkidle, selector, text, url
 * @param {Object} opts.target - Resolved target handle owned by daemon
 * @param {string} [opts.condition] - Selector, text, or URL value for conditional waits
 * @param {number} [opts.timeout] - Maximum wait time in milliseconds
 * @returns {Object} wait result
 */
export async function wait({ profileId, target, for_: forCondition = 'load', condition = null, timeout = 30000, ms }) {
  const pid = safeId(profileId, 'profileId');
  const allowed = new Set(['load', 'domcontentloaded', 'networkidle', 'selector', 'text', 'url']);
  if (!allowed.has(forCondition)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'for', value: forCondition } });
  const timeoutMs = typeof timeout === 'number' && timeout >= 0 ? timeout : 30000;
  const page = getTargetPageOrThrow(target);
  if (['selector', 'text', 'url'].includes(forCondition) && !condition) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'condition' } });
  }
  emit(pid, 'wait.start', { for: forCondition, condition, timeout: timeoutMs });
  try {
    if (typeof ms === 'number' && ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, ms));
    } else if (forCondition === 'selector') {
      await page.locator(condition).waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (forCondition === 'text') {
      await page.getByText(condition, { exact: false }).waitFor({ state: 'visible', timeout: timeoutMs });
    } else if (forCondition === 'url') {
      await page.waitForURL(condition, { timeout: timeoutMs });
    } else {
      await page.waitForLoadState(forCondition, { timeout: timeoutMs });
    }
  } catch (cause) {
    emit(pid, 'wait.error', { for: forCondition, condition, error: cause?.message });
    throw new CamoError({ code: 'E_IO_TIMEOUT', details: { profileId: pid, targetId: target.targetId, for: forCondition, condition, timeout: timeoutMs, reason: cause?.message }, cause });
  }
  const result = { profileId: pid, targetId: target.targetId, waited: true, satisfied: true, for: forCondition, condition, timeout: timeoutMs };
  emit(pid, 'wait.done', result);
  return result;
}

/**
 * Wait for DOM to be stable (no mutations for a period).
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} [opts.timeout] - Max wait time in ms (default 5000)
 * @param {number} [opts.pollInterval] - Poll interval in ms (default 500)
 * @returns {Object} DOM stability result
 */
export async function waitForDomStable({ profileId, target, timeout, pollInterval }) {
  const pid = safeId(profileId, 'profileId');
  const page = getTargetPageOrThrow(target);
  const t = typeof timeout === 'number' && timeout > 0 ? timeout : 5000;
  const poll = typeof pollInterval === 'number' && pollInterval > 0 ? pollInterval : 500;
  emit(pid, 'waitForDomStable.start', { timeout: t, pollInterval: poll });
  try {
    const result = await page.evaluate(({ timeoutMs, pollMs }) => {
      return new Promise((resolve) => {
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
    const output = { profileId: pid, targetId: target.targetId, ...result };
    emit(pid, 'waitForDomStable.done', { stable: result.stable });
    return output;
  } catch (cause) {
    emit(pid, 'waitForDomStable.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_WAITFORDOMSTABLE_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}
