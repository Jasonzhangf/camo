import { getDomSnapshotByProfile } from '../../utils/browser-service.mjs';
import { ChangeNotifier } from '../change-notifier.mjs';
import { ensureActiveSession, getCurrentUrl, normalizeArray } from './utils.mjs';

function resolveFilterMode(input) {
  const text = String(input || process.env.CAMO_FILTER_MODE || 'strict').trim().toLowerCase();
  if (!text) return 'strict';
  if (text === 'legacy') return 'legacy';
  return 'strict';
}

function urlMatchesFilter(url, item) {
  const href = String(url || '').trim();
  const includes = normalizeArray(item?.pageUrlIncludes).map((token) => String(token || '').trim()).filter(Boolean);
  const excludes = normalizeArray(item?.pageUrlExcludes).map((token) => String(token || '').trim()).filter(Boolean);
  if (includes.length > 0 && !includes.every((token) => href.includes(token))) return false;
  if (excludes.length > 0 && excludes.some((token) => href.includes(token))) return false;
  return true;
}

export async function watchSubscriptions({
  profileId,
  subscriptions,
  throttle = 500,
  filterMode = 'strict',
  onEvent = () => {},
  onError = () => {},
}) {
  const session = await ensureActiveSession(profileId);
  const resolvedProfile = session.profileId || profileId;
  const notifier = new ChangeNotifier();
  const effectiveFilterMode = resolveFilterMode(filterMode);
  const strictFilter = effectiveFilterMode === 'strict';
  const items = normalizeArray(subscriptions)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const id = String(item.id || `sub_${index + 1}`);
      const selector = String(item.selector || '').trim();
      if (!selector) return null;
      const events = normalizeArray(item.events).map((name) => String(name).trim()).filter(Boolean);
      const pageUrlIncludes = normalizeArray(item.pageUrlIncludes).map((token) => String(token || '').trim()).filter(Boolean);
      const pageUrlExcludes = normalizeArray(item.pageUrlExcludes).map((token) => String(token || '').trim()).filter(Boolean);
      return {
        id,
        selector,
        visible: strictFilter ? true : (item.visible !== false),
        pageUrlIncludes,
        pageUrlExcludes,
        events: events.length > 0 ? new Set(events) : null,
      };
    })
    .filter(Boolean);

  const state = new Map(items.map((item) => [item.id, { exists: false, stateSig: '', appearCount: 0 }]));
  const intervalMs = Math.max(100, Number(throttle) || 500);
  let stopped = false;

  const emit = async (payload) => {
    try {
      await onEvent(payload);
    } catch (err) {
      onError(err);
    }
  };

  const poll = async () => {
    if (stopped) return;
    try {
      const snapshot = await getDomSnapshotByProfile(resolvedProfile);
      const currentUrl = await getCurrentUrl(resolvedProfile).catch(() => '');
      const ts = new Date().toISOString();
      for (const item of items) {
        const prev = state.get(item.id) || { exists: false, stateSig: '', appearCount: 0 };
        const urlMatched = urlMatchesFilter(currentUrl, item);
        const elements = urlMatched
          ? notifier.findElements(snapshot, { css: item.selector, visible: item.visible })
          : [];
        const exists = elements.length > 0;
        const stateSig = elements.map((node) => node.path).sort().join(',');
        const changed = stateSig !== prev.stateSig;
        const next = {
          exists,
          stateSig,
          appearCount: prev.appearCount + (exists && !prev.exists ? 1 : 0),
        };
        state.set(item.id, next);

        const shouldEmit = (type) => !item.events || item.events.has(type);
        if (exists && !prev.exists && shouldEmit('appear')) {
          await emit({
            type: 'appear',
            profileId: resolvedProfile,
            subscriptionId: item.id,
            selector: item.selector,
            count: elements.length,
            elements,
            pageUrl: currentUrl,
            filterMode: effectiveFilterMode,
            timestamp: ts,
          });
        }
        if (!exists && prev.exists && shouldEmit('disappear')) {
          await emit({
            type: 'disappear',
            profileId: resolvedProfile,
            subscriptionId: item.id,
            selector: item.selector,
            count: 0,
            elements: [],
            pageUrl: currentUrl,
            filterMode: effectiveFilterMode,
            timestamp: ts,
          });
        }
        if (exists && shouldEmit('exist')) {
          await emit({
            type: 'exist',
            profileId: resolvedProfile,
            subscriptionId: item.id,
            selector: item.selector,
            count: elements.length,
            elements,
            pageUrl: currentUrl,
            filterMode: effectiveFilterMode,
            timestamp: ts,
          });
        }
        if (changed && shouldEmit('change')) {
          await emit({
            type: 'change',
            profileId: resolvedProfile,
            subscriptionId: item.id,
            selector: item.selector,
            count: elements.length,
            elements,
            pageUrl: currentUrl,
            filterMode: effectiveFilterMode,
            timestamp: ts,
          });
        }
      }
      await emit({ type: 'tick', profileId: resolvedProfile, timestamp: ts });
    } catch (err) {
      onError(err);
    }
  };

  const interval = setInterval(poll, intervalMs);
  await poll();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
    },
    profileId: resolvedProfile,
  };
}
