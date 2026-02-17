import { getDomSnapshotByProfile } from '../../utils/browser-service.mjs';
import { detectCheckpoint } from './checkpoint.mjs';
import {
  asErrorPayload,
  buildSelectorCheck,
  ensureActiveSession,
  getCurrentUrl,
  maybeSelector,
  normalizeArray,
} from './utils.mjs';

async function validatePage(profileId, spec = {}, platform = 'xiaohongshu') {
  const url = await getCurrentUrl(profileId);
  const includes = normalizeArray(spec.urlIncludes || []);
  const excludes = normalizeArray(spec.urlExcludes || []);
  const hostIncludes = normalizeArray(spec.hostIncludes || []);
  const errors = [];

  for (const token of includes) {
    if (!url.includes(String(token))) errors.push(`url missing token: ${token}`);
  }
  for (const token of excludes) {
    if (url.includes(String(token))) errors.push(`url contains forbidden token: ${token}`);
  }
  if (hostIncludes.length > 0 && !hostIncludes.some((token) => url.includes(String(token)))) {
    errors.push(`url host mismatch, expected one of: ${hostIncludes.join(',')}`);
  }

  const checkpoints = normalizeArray(spec.checkpointIn || []);
  let checkpoint = null;
  if (checkpoints.length > 0) {
    const detected = await detectCheckpoint({ profileId, platform });
    checkpoint = detected?.data?.checkpoint || null;
    if (!checkpoints.includes(checkpoint)) {
      errors.push(`checkpoint mismatch: got ${checkpoint}, expect one of ${checkpoints.join(',')}`);
    }
  }

  return {
    ok: errors.length === 0,
    url,
    checkpoint,
    errors,
  };
}

async function validateContainer(profileId, spec = {}) {
  const snapshot = await getDomSnapshotByProfile(profileId);
  const selector = maybeSelector({
    profileId,
    containerId: spec.containerId || null,
    selector: spec.selector || null,
  });
  if (!selector) {
    return { ok: false, selector: null, count: 0, errors: ['container selector not resolved'] };
  }
  const matched = buildSelectorCheck(snapshot, selector);
  const count = matched.length;
  const mustExist = spec.mustExist !== false;
  const minCount = Number.isFinite(Number(spec.minCount)) ? Number(spec.minCount) : (mustExist ? 1 : 0);
  const maxCount = Number.isFinite(Number(spec.maxCount)) ? Number(spec.maxCount) : null;
  const errors = [];

  if (count < minCount) errors.push(`container count too small: ${count} < ${minCount}`);
  if (maxCount !== null && count > maxCount) errors.push(`container count too large: ${count} > ${maxCount}`);
  if (!mustExist && minCount === 0) {
    return { ok: true, selector, count, errors: [] };
  }
  return { ok: errors.length === 0, selector, count, errors };
}

export async function validateOperation({
  profileId,
  validationSpec = {},
  phase = 'pre',
  context = {},
  platform = 'xiaohongshu',
}) {
  try {
    const mode = String(validationSpec.mode || 'none').toLowerCase();
    if (mode === 'none') {
      return { ok: true, code: 'VALIDATION_SKIPPED', message: 'Validation skipped', data: { phase, mode } };
    }
    if (phase === 'pre' && mode === 'post') {
      return { ok: true, code: 'VALIDATION_SKIPPED', message: 'Pre validation skipped by mode=post', data: { phase, mode } };
    }
    if (phase === 'post' && mode === 'pre') {
      return { ok: true, code: 'VALIDATION_SKIPPED', message: 'Post validation skipped by mode=pre', data: { phase, mode } };
    }

    const effective = validationSpec[phase] || {};
    const resolvedProfile = (await ensureActiveSession(profileId)).profileId || profileId;
    const pageResult = effective.page
      ? await validatePage(resolvedProfile, effective.page, platform)
      : { ok: true, errors: [] };
    const containerResult = effective.container
      ? await validateContainer(resolvedProfile, effective.container)
      : { ok: true, errors: [] };
    const allErrors = [...normalizeArray(pageResult.errors), ...normalizeArray(containerResult.errors)];

    if (allErrors.length > 0) {
      return asErrorPayload('VALIDATION_FAILED', `Validation failed at phase=${phase}`, {
        phase,
        mode,
        errors: allErrors,
        page: pageResult,
        container: containerResult,
        context,
      });
    }

    return {
      ok: true,
      code: 'VALIDATION_PASSED',
      message: `Validation passed at phase=${phase}`,
      data: {
        phase,
        mode,
        page: pageResult,
        container: containerResult,
        context,
      },
    };
  } catch (err) {
    return asErrorPayload('VALIDATION_FAILED', err?.message || String(err), { phase, context });
  }
}
