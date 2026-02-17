import { callAPI, getDomSnapshotByProfile } from '../../../utils/browser-service.mjs';
import { executeTabPoolOperation } from './tab-pool.mjs';
import {
  buildSelectorClickScript,
  buildSelectorScrollIntoViewScript,
  buildSelectorTypeScript,
} from './selector-scripts.mjs';
import { executeViewportOperation } from './viewport.mjs';
import {
  asErrorPayload,
  buildSelectorCheck,
  ensureActiveSession,
  extractPageList,
  getCurrentUrl,
  maybeSelector,
  normalizeArray,
} from '../utils.mjs';

const TAB_ACTIONS = new Set([
  'ensure_tab_pool',
  'tab_pool_switch_next',
  'tab_pool_switch_slot',
]);

const VIEWPORT_ACTIONS = new Set([
  'sync_window_viewport',
  'get_current_url',
]);

async function executeExternalOperationIfAny({
  profileId,
  action,
  params,
  operation,
  context,
}) {
  const executor = context?.executeExternalOperation;
  if (typeof executor !== 'function') return null;
  const result = await executor({
    profileId,
    action,
    params,
    operation,
    context,
  });
  if (result === null || result === undefined) return null;
  if (result && typeof result === 'object' && typeof result.ok === 'boolean') {
    return result;
  }
  return asErrorPayload('OPERATION_FAILED', 'external operation executor returned invalid payload', {
    action,
    resultType: typeof result,
  });
}

async function flashOperationViewport(profileId, params = {}) {
  if (params.highlight === false) return;
  try {
    await callAPI('evaluate', {
      profileId,
      script: `(() => {
        const root = document.documentElement;
        if (!(root instanceof HTMLElement)) return { ok: false };
        const prevShadow = root.style.boxShadow;
        const prevTransition = root.style.transition;
        root.style.transition = 'box-shadow 80ms ease';
        root.style.boxShadow = 'inset 0 0 0 3px #ff7a00';
        setTimeout(() => {
          root.style.boxShadow = prevShadow;
          root.style.transition = prevTransition;
        }, 260);
        return { ok: true };
      })()`,
    });
  } catch {
    // highlight failure should never block action execution
  }
}

async function executeSelectorOperation({ profileId, action, operation, params }) {
  const selector = maybeSelector({
    profileId,
    containerId: params.containerId || operation?.containerId || null,
    selector: params.selector || operation?.selector || null,
  });
  if (!selector) return asErrorPayload('CONTAINER_NOT_FOUND', `${action} requires selector/containerId`);

  const highlight = params.highlight !== false;
  if (action === 'scroll_into_view') {
    const script = buildSelectorScrollIntoViewScript({ selector, highlight });
    const result = await callAPI('evaluate', {
      profileId,
      script,
    });
    return { ok: true, code: 'OPERATION_DONE', message: 'scroll_into_view done', data: result };
  }

  const typeText = String(params.text ?? params.value ?? '');
  const script = action === 'click'
    ? buildSelectorClickScript({ selector, highlight })
    : buildSelectorTypeScript({ selector, highlight, text: typeText });
  const result = await callAPI('evaluate', { profileId, script });
  return { ok: true, code: 'OPERATION_DONE', message: `${action} done`, data: result };
}

async function executeVerifySubscriptions({ profileId, params }) {
  const defaultVisible = params.visible !== false;
  const defaultMinCount = Math.max(0, Number(params.minCount ?? 1) || 1);
  const selectorItems = normalizeArray(params.subscriptions || params.selectors)
    .map((item, idx) => {
      if (typeof item === 'string') {
        return {
          id: `selector_${idx + 1}`,
          selector: item,
          visible: defaultVisible,
          minCount: defaultMinCount,
        };
      }
      if (!item || typeof item !== 'object') return null;
      const selector = String(item.selector || '').trim();
      if (!selector) return null;
      const visible = item.visible !== undefined
        ? item.visible !== false
        : defaultVisible;
      const minCount = Math.max(0, Number(item.minCount ?? defaultMinCount) || defaultMinCount);
      return {
        id: String(item.id || `selector_${idx + 1}`),
        selector,
        visible,
        minCount,
      };
    })
    .filter(Boolean);
  if (selectorItems.length === 0) {
    return asErrorPayload('OPERATION_FAILED', 'verify_subscriptions requires params.selectors');
  }

  const acrossPages = params.acrossPages === true;
  const settleMs = Math.max(0, Number(params.settleMs ?? 280) || 280);

  const collectForCurrentPage = async () => {
    const snapshot = await getDomSnapshotByProfile(profileId);
    const url = await getCurrentUrl(profileId);
    const matches = selectorItems.map((item) => ({
      id: item.id,
      selector: item.selector,
      visible: item.visible,
      minCount: item.minCount,
      count: buildSelectorCheck(snapshot, {
        css: item.selector,
        visible: item.visible,
      }).length,
    }));
    return { url, matches };
  };

  let pagesResult = [];
  let overallOk = true;
  if (!acrossPages) {
    const current = await collectForCurrentPage();
    overallOk = current.matches.every((item) => item.count >= item.minCount);
    pagesResult = [{ index: null, ...current }];
  } else {
    const listed = await callAPI('page:list', { profileId });
    const { pages, activeIndex } = extractPageList(listed);
    for (const page of pages) {
      const pageIndex = Number(page.index);
      if (Number.isFinite(activeIndex) && activeIndex !== pageIndex) {
        await callAPI('page:switch', { profileId, index: pageIndex });
        if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      }
      const current = await collectForCurrentPage();
      const pageOk = current.matches.every((item) => item.count >= item.minCount);
      overallOk = overallOk && pageOk;
      pagesResult.push({ index: pageIndex, ...current, ok: pageOk });
    }
    if (Number.isFinite(activeIndex)) {
      await callAPI('page:switch', { profileId, index: activeIndex });
    }
  }

  if (!overallOk) {
    return asErrorPayload('SUBSCRIPTION_MISMATCH', 'subscription selectors missing on one or more pages', {
      acrossPages,
      pages: pagesResult,
    });
  }

  return {
    ok: true,
    code: 'OPERATION_DONE',
    message: 'verify_subscriptions done',
    data: { acrossPages, pages: pagesResult },
  };
}

export async function executeOperation({ profileId, operation, context = {} }) {
  try {
    const session = await ensureActiveSession(profileId);
    const resolvedProfile = session.profileId || profileId;
    const action = String(operation?.action || '').trim();
    const params = operation?.params || operation?.config || {};

    if (!action) {
      return asErrorPayload('OPERATION_FAILED', 'operation.action is required');
    }

    if (action !== 'wait') {
      await flashOperationViewport(resolvedProfile, params);
    }

    if (TAB_ACTIONS.has(action)) {
      return await executeTabPoolOperation({
        profileId: resolvedProfile,
        action,
        params,
        context,
      });
    }

    if (VIEWPORT_ACTIONS.has(action)) {
      return await executeViewportOperation({
        profileId: resolvedProfile,
        action,
        params,
      });
    }

    if (action === 'goto') {
      const url = String(params.url || params.value || '').trim();
      if (!url) return asErrorPayload('OPERATION_FAILED', 'goto requires params.url');
      const result = await callAPI('goto', { profileId: resolvedProfile, url });
      return { ok: true, code: 'OPERATION_DONE', message: 'goto done', data: result };
    }

    if (action === 'back') {
      const result = await callAPI('page:back', { profileId: resolvedProfile });
      return { ok: true, code: 'OPERATION_DONE', message: 'back done', data: result };
    }

    if (action === 'list_pages') {
      const result = await callAPI('page:list', { profileId: resolvedProfile });
      const { pages, activeIndex } = extractPageList(result);
      return { ok: true, code: 'OPERATION_DONE', message: 'list_pages done', data: { pages, activeIndex, raw: result } };
    }

    if (action === 'new_page') {
      const rawUrl = String(params.url || params.value || '').trim();
      const payload = rawUrl ? { profileId: resolvedProfile, url: rawUrl } : { profileId: resolvedProfile };
      const result = await callAPI('newPage', payload);
      return { ok: true, code: 'OPERATION_DONE', message: 'new_page done', data: result };
    }

    if (action === 'switch_page') {
      const index = Number(params.index ?? params.value);
      if (!Number.isFinite(index)) {
        return asErrorPayload('OPERATION_FAILED', 'switch_page requires params.index');
      }
      const result = await callAPI('page:switch', { profileId: resolvedProfile, index });
      return { ok: true, code: 'OPERATION_DONE', message: 'switch_page done', data: result };
    }

    if (action === 'wait') {
      const ms = Math.max(0, Number(params.ms ?? params.value ?? 0));
      await new Promise((resolve) => setTimeout(resolve, ms));
      return { ok: true, code: 'OPERATION_DONE', message: 'wait done', data: { ms } };
    }

    if (action === 'scroll') {
      const amount = Math.max(1, Number(params.amount ?? params.value ?? 300) || 300);
      const direction = String(params.direction || 'down').toLowerCase();
      let deltaX = 0;
      let deltaY = amount;
      if (direction === 'up') deltaY = -amount;
      else if (direction === 'left') {
        deltaX = -amount;
        deltaY = 0;
      } else if (direction === 'right') {
        deltaX = amount;
        deltaY = 0;
      }
      const result = await callAPI('mouse:wheel', { profileId: resolvedProfile, deltaX, deltaY });
      return {
        ok: true,
        code: 'OPERATION_DONE',
        message: 'scroll done',
        data: { direction, amount, deltaX, deltaY, result },
      };
    }

    if (action === 'press_key') {
      const key = String(params.key || params.value || '').trim();
      if (!key) return asErrorPayload('OPERATION_FAILED', 'press_key requires params.key');
      const result = await callAPI('evaluate', {
        profileId: resolvedProfile,
        script: `(async () => {
          const target = document.activeElement || document.body || document.documentElement;
          const key = ${JSON.stringify(key)};
          const code = key.length === 1 ? 'Key' + key.toUpperCase() : key;
          const opts = { key, code, bubbles: true, cancelable: true };
          target.dispatchEvent(new KeyboardEvent('keydown', opts));
          target.dispatchEvent(new KeyboardEvent('keypress', opts));
          target.dispatchEvent(new KeyboardEvent('keyup', opts));
          if (key === 'Escape') {
            const closeButton = document.querySelector('.note-detail-mask .close-box, .note-detail-mask .close-circle');
            if (closeButton instanceof HTMLElement) closeButton.click();
          }
          if (key === 'Enter' && target instanceof HTMLInputElement && target.form) {
            if (typeof target.form.requestSubmit === 'function') target.form.requestSubmit();
            else target.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
          return { key, targetTag: target?.tagName || null };
        })()`,
      });
      return { ok: true, code: 'OPERATION_DONE', message: 'press_key done', data: result };
    }

    if (action === 'verify_subscriptions') {
      return executeVerifySubscriptions({ profileId: resolvedProfile, params });
    }

    if (action === 'evaluate') {
      const script = String(params.script || '').trim();
      if (!script) return asErrorPayload('OPERATION_FAILED', 'evaluate requires params.script');
      const result = await callAPI('evaluate', { profileId: resolvedProfile, script });
      return { ok: true, code: 'OPERATION_DONE', message: 'evaluate done', data: result };
    }

    if (action === 'click' || action === 'type' || action === 'scroll_into_view') {
      return executeSelectorOperation({
        profileId: resolvedProfile,
        action,
        operation,
        params,
      });
    }

    const externalResult = await executeExternalOperationIfAny({
      profileId: resolvedProfile,
      action,
      params,
      operation,
      context,
    });
    if (externalResult) return externalResult;

    return asErrorPayload('UNSUPPORTED_OPERATION', `Unsupported operation action: ${action}`);
  } catch (err) {
    return asErrorPayload('OPERATION_FAILED', err?.message || String(err), { context });
  }
}
