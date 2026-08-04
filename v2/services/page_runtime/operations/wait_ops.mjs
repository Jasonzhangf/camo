// Wait operations. truth_owner: page_runtime.
//
// Wait: wait, waitForDomStable.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import { safeId, getPageOrThrow, emit } from './_page_helpers.mjs';

/**
 * Wait for a duration.
 * @param {Object} opts
 * @param {string} opts.profileId
 * @param {number} [opts.ms] - Milliseconds to wait (default 1000)
 * @returns {Object} wait result
 */
export async function wait({ profileId, ms = 1000 }) {
  const pid = safeId(profileId, 'profileId');
  const waitMs = typeof ms === 'number' && ms > 0 ? ms : 1000;
  emit(pid, 'wait.start', { ms: waitMs });
  await new Promise(resolve => setTimeout(resolve, waitMs));
  const result = { profileId: pid, waited: true, ms: waitMs };
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
export async function waitForDomStable({ profileId, timeout, pollInterval }) {
  const pid = safeId(profileId, 'profileId');
  const page = getPageOrThrow(pid);
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
    const output = { profileId: pid, ...result };
    emit(pid, 'waitForDomStable.done', { stable: result.stable });
    return output;
  } catch (cause) {
    emit(pid, 'waitForDomStable.error', { error: cause?.message });
    throw new CamoError({ code: 'E_BROWSER_WAITFORDOMSTABLE_FAILED', details: { profileId: pid, reason: cause?.message }, cause });
  }
}
