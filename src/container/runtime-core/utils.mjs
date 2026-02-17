import { callAPI, getSessionByProfile } from '../../utils/browser-service.mjs';
import { getDefaultProfile } from '../../utils/config.mjs';
import { ChangeNotifier } from '../change-notifier.mjs';
import { getRegisteredTargets } from '../subscription-registry.mjs';

export function asErrorPayload(code, message, data = {}) {
  return { ok: false, code, message, data };
}

export function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function extractPageList(payload) {
  const pages = normalizeArray(payload?.pages || payload?.data?.pages)
    .map((item, idx) => {
      const rawIndex = Number(item?.index);
      return {
        ...item,
        index: Number.isFinite(rawIndex) ? rawIndex : idx,
      };
    })
    .sort((a, b) => Number(a.index) - Number(b.index));
  const activeIndex = Number(payload?.activeIndex ?? payload?.data?.activeIndex);
  return {
    pages,
    activeIndex: Number.isFinite(activeIndex) ? activeIndex : null,
  };
}

export async function getCurrentUrl(profileId) {
  const res = await callAPI('evaluate', {
    profileId,
    script: 'window.location.href',
  });
  return String(res?.result || res?.data?.result || '');
}

function firstSelectorForContainer(profileId, containerId) {
  const targets = getRegisteredTargets(profileId)?.profile;
  const selectors = normalizeArray(targets?.selectors);
  const direct = selectors.find((item) => item?.setId === containerId && typeof item?.css === 'string');
  if (direct?.css) return direct.css;

  const fallbackTarget = normalizeArray(targets?.targets).find(
    (item) => item?.containerId === containerId && item?.markerType === 'url_dom' && item?.dom?.css,
  );
  if (fallbackTarget?.dom?.css) return fallbackTarget.dom.css;
  return null;
}

export function maybeSelector({ profileId, containerId, selector }) {
  if (selector && typeof selector === 'string') return selector;
  if (containerId && typeof containerId === 'string') {
    return firstSelectorForContainer(profileId, containerId);
  }
  return null;
}

export function buildSelectorCheck(snapshot, selector) {
  if (!snapshot || !selector) return [];
  const notifier = new ChangeNotifier();
  if (typeof selector === 'string') {
    return notifier.findElements(snapshot, { css: selector });
  }
  if (selector && typeof selector === 'object') {
    return notifier.findElements(snapshot, selector);
  }
  return [];
}

export function isCheckpointRiskUrl(url) {
  const lower = String(url || '').toLowerCase();
  return (
    lower.includes('/website-login/captcha')
    || lower.includes('verifyuuid=')
    || lower.includes('verifytype=')
    || lower.includes('verifybiz=')
    || lower.includes('/website-login/verify')
    || lower.includes('/website-login/security')
  );
}

export async function ensureActiveSession(profileId) {
  const targetProfile = profileId || getDefaultProfile();
  if (!targetProfile) {
    throw new Error('profileId is required');
  }
  const session = await getSessionByProfile(targetProfile);
  if (!session) {
    throw new Error(`No active session for profile: ${targetProfile}`);
  }
  return session;
}
