import { getDomSnapshotByProfile } from '../../utils/browser-service.mjs';
import { ChangeNotifier } from '../change-notifier.mjs';
import { ensureActiveSession, normalizeArray } from './utils.mjs';

export async function watchSubscriptions({
  profileId,
  subscriptions,
  throttle = 500,
  onEvent = () => {},
  onError = () => {},
}) {
  const session = await ensureActiveSession(profileId);
  const resolvedProfile = session.profileId || profileId;
  const notifier = new ChangeNotifier();
  const items = normalizeArray(subscriptions)
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const id = String(item.id || `sub_${index + 1}`);
      const selector = String(item.selector || '').trim();
      if (!selector) return null;
      const events = normalizeArray(item.events).map((name) => String(name).trim()).filter(Boolean);
      return { id, selector, events: events.length > 0 ? new Set(events) : null };
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
      const ts = new Date().toISOString();
      for (const item of items) {
        const prev = state.get(item.id) || { exists: false, stateSig: '', appearCount: 0 };
        const elements = notifier.findElements(snapshot, { css: item.selector });
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
          await emit({ type: 'appear', profileId: resolvedProfile, subscriptionId: item.id, selector: item.selector, count: elements.length, elements, timestamp: ts });
        }
        if (!exists && prev.exists && shouldEmit('disappear')) {
          await emit({ type: 'disappear', profileId: resolvedProfile, subscriptionId: item.id, selector: item.selector, count: 0, elements: [], timestamp: ts });
        }
        if (exists && shouldEmit('exist')) {
          await emit({ type: 'exist', profileId: resolvedProfile, subscriptionId: item.id, selector: item.selector, count: elements.length, elements, timestamp: ts });
        }
        if (changed && shouldEmit('change')) {
          await emit({ type: 'change', profileId: resolvedProfile, subscriptionId: item.id, selector: item.selector, count: elements.length, elements, timestamp: ts });
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
