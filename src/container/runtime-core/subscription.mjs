import { getDomSnapshotByProfile } from '../../utils/browser-service.mjs';
import { ChangeNotifier } from '../change-notifier.mjs';
import { ensureActiveSession, getCurrentUrl, normalizeArray } from './utils.mjs';

function normalizeElementKeys(elements) {
  return (Array.isArray(elements) ? elements : [])
    .map((node) => String(node?.path || '').trim())
    .filter(Boolean)
    .sort();
}

function joinElementKeys(keys) {
  return Array.isArray(keys) && keys.length > 0 ? keys.join('|') : 'none';
}

function buildEventKey(subscriptionId, type, presenceVersion, keys) {
  return `${subscriptionId}:${type}:p${Math.max(0, Number(presenceVersion) || 0)}:k${joinElementKeys(keys)}`;
}

export function isTransientSubscriptionError(error) {
  const message = String(error?.message || error || '').trim().toLowerCase();
  if (!message) return false;
  return message.includes('execution context was destroyed')
    || message.includes('most likely because of a navigation')
    || message.includes('cannot find context with specified id')
    || message.includes('target closed');
}

function resolveFilterMode(input) {
  const text = String(input || process.env.CAMO_FILTER_MODE || 'strict').trim().toLowerCase();
  if (!text) return 'strict';
  if (text === 'legacy') return 'legacy';
  return 'strict';
}

function urlMatchesFilter(url, item) {
  const href = String(url || '').trim();
  const includes = normalizeArray(item?.pageUrlIncludes || item?.urlIncludes).map((token) => String(token || '').trim()).filter(Boolean);
  const excludes = normalizeArray(item?.pageUrlExcludes || item?.urlExcludes).map((token) => String(token || '').trim()).filter(Boolean);
  if (includes.length > 0 && !includes.some((token) => href.includes(token))) return false;
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

  const state = new Map(items.map((item) => [item.id, {
    exists: false,
    stateSig: '',
    appearCount: 0,
    presenceVersion: 0,
    elementKeys: [],
  }]));
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
      const currentUrl = String(snapshot?.__url || '') || await getCurrentUrl(resolvedProfile).catch(() => '');
      const ts = new Date().toISOString();
      for (const item of items) {
        const prev = state.get(item.id) || {
          exists: false,
          stateSig: '',
          appearCount: 0,
          presenceVersion: 0,
          elementKeys: [],
        };
        const urlMatched = urlMatchesFilter(currentUrl, item);
        const elements = urlMatched
          ? notifier.findElements(snapshot, { css: item.selector, visible: item.visible })
          : [];
        const exists = elements.length > 0;
        const elementKeys = normalizeElementKeys(elements);
        const prevElementKeys = Array.isArray(prev.elementKeys) ? prev.elementKeys : [];
        const prevElementKeySet = new Set(prevElementKeys);
        const elementKeySet = new Set(elementKeys);
        const appearedKeys = elementKeys.filter((key) => !prevElementKeySet.has(key));
        const disappearedKeys = prevElementKeys.filter((key) => !elementKeySet.has(key));
        const stateSig = elementKeys.join(',');
        const changed = stateSig !== prev.stateSig;
        const presenceVersion = prev.presenceVersion + (exists && !prev.exists ? 1 : 0);
        const next = {
          exists,
          stateSig,
          appearCount: prev.appearCount + (exists && !prev.exists ? 1 : 0),
          presenceVersion,
          elementKeys,
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
            elementKeys,
            presenceVersion,
            stateKey: stateSig,
            eventKey: buildEventKey(item.id, 'appear', presenceVersion, appearedKeys.length > 0 ? appearedKeys : elementKeys),
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
            elementKeys: [],
            departedElementKeys: disappearedKeys,
            presenceVersion: prev.presenceVersion,
            stateKey: '',
            eventKey: buildEventKey(item.id, 'disappear', prev.presenceVersion, disappearedKeys),
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
            elementKeys,
            presenceVersion,
            stateKey: stateSig,
            eventKey: buildEventKey(item.id, 'exist', presenceVersion, elementKeys),
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
            elementKeys,
            appearedElementKeys: appearedKeys,
            departedElementKeys: disappearedKeys,
            presenceVersion,
            stateKey: stateSig,
            eventKey: buildEventKey(item.id, 'change', presenceVersion, elementKeys),
            timestamp: ts,
          });
        }
      }
      await emit({ type: 'tick', profileId: resolvedProfile, timestamp: ts });
    } catch (err) {
      if (isTransientSubscriptionError(err)) return;
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
