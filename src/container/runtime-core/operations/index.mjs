import { callAPI, getDomSnapshotByProfile } from '../../../utils/browser-service.mjs';
import { isJsExecutionEnabled } from '../../../utils/js-policy.mjs';
import { executeTabPoolOperation } from './tab-pool.mjs';
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

const DEFAULT_MODAL_SELECTORS = [
  '[aria-modal="true"]',
  '[role="dialog"]',
  '.modal',
  '.dialog',
  '.note-detail-mask',
  '.note-detail-page',
  '.note-detail-dialog',
];

function resolveFilterMode(input) {
  const text = String(input || process.env.CAMO_FILTER_MODE || 'strict').trim().toLowerCase();
  if (!text) return 'strict';
  if (text === 'legacy') return 'legacy';
  return 'strict';
}

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
  if (!isJsExecutionEnabled()) return;
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isTargetFullyInViewport(target, margin = 6) {
  const rect = target?.rect && typeof target.rect === 'object' ? target.rect : null;
  const viewport = target?.viewport && typeof target.viewport === 'object' ? target.viewport : null;
  if (!rect || !viewport) return true;
  const vw = Number(viewport.width || 0);
  const vh = Number(viewport.height || 0);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return true;
  const left = Number(rect.left || 0);
  const top = Number(rect.top || 0);
  const width = Math.max(0, Number(rect.width || 0));
  const height = Math.max(0, Number(rect.height || 0));
  const right = left + width;
  const bottom = top + height;
  const m = Math.max(0, Number(margin) || 0);
  return left >= m && top >= m && right <= (vw - m) && bottom <= (vh - m);
}

function resolveViewportScrollDelta(target, margin = 6) {
  const rect = target?.rect && typeof target.rect === 'object' ? target.rect : null;
  const viewport = target?.viewport && typeof target.viewport === 'object' ? target.viewport : null;
  if (!rect || !viewport) return { deltaX: 0, deltaY: 0 };
  const vw = Number(viewport.width || 0);
  const vh = Number(viewport.height || 0);
  if (!Number.isFinite(vw) || !Number.isFinite(vh) || vw <= 0 || vh <= 0) return { deltaX: 0, deltaY: 0 };
  const left = Number(rect.left || 0);
  const top = Number(rect.top || 0);
  const width = Math.max(0, Number(rect.width || 0));
  const height = Math.max(0, Number(rect.height || 0));
  const right = left + width;
  const bottom = top + height;
  const m = Math.max(0, Number(margin) || 0);

  let deltaX = 0;
  let deltaY = 0;

  if (left < m) {
    deltaX = Math.round(left - m);
  } else if (right > (vw - m)) {
    deltaX = Math.round(right - (vw - m));
  }

  if (top < m) {
    deltaY = Math.round(top - m);
  } else if (bottom > (vh - m)) {
    deltaY = Math.round(bottom - (vh - m));
  }

  if (Math.abs(deltaY) < 80 && !isTargetFullyInViewport(target, m)) {
    deltaY = deltaY >= 0 ? 120 : -120;
  }
  if (Math.abs(deltaX) < 40 && (left < m || right > (vw - m))) {
    deltaX = deltaX >= 0 ? 60 : -60;
  }

  return {
    deltaX: clamp(deltaX, -900, 900),
    deltaY: clamp(deltaY, -900, 900),
  };
}

function normalizeRect(node) {
  const rect = node?.rect && typeof node.rect === 'object' ? node.rect : null;
  if (!rect) return null;
  const left = Number(rect.left ?? rect.x ?? 0);
  const top = Number(rect.top ?? rect.y ?? 0);
  const width = Number(rect.width ?? 0);
  const height = Number(rect.height ?? 0);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

function nodeArea(node) {
  const rect = normalizeRect(node);
  if (!rect) return 0;
  return Number(rect.width || 0) * Number(rect.height || 0);
}

function nodeCenter(node, viewport = null) {
  const rect = normalizeRect(node);
  const vw = Number(viewport?.width || 0);
  const vh = Number(viewport?.height || 0);
  if (!rect) return null;
  const rawX = rect.left + Math.max(1, rect.width / 2);
  const rawY = rect.top + Math.max(1, rect.height / 2);
  const centerX = vw > 1
    ? clamp(Math.round(rawX), 1, Math.max(1, vw - 1))
    : Math.max(1, Math.round(rawX));
  const centerY = vh > 1
    ? clamp(Math.round(rawY), 1, Math.max(1, vh - 1))
    : Math.max(1, Math.round(rawY));
  return {
    center: { x: centerX, y: centerY },
    rawCenter: { x: rawX, y: rawY },
    rect,
  };
}

function getSnapshotViewport(snapshot) {
  const width = Number(snapshot?.__viewport?.width || 0);
  const height = Number(snapshot?.__viewport?.height || 0);
  return { width, height };
}

function isPathWithin(path, parentPath) {
  const child = String(path || '').trim();
  const parent = String(parentPath || '').trim();
  if (!child || !parent) return false;
  return child === parent || child.startsWith(`${parent}/`);
}

function resolveActiveModal(snapshot) {
  if (!snapshot) return null;
  const rows = [];
  for (const selector of DEFAULT_MODAL_SELECTORS) {
    const matches = buildSelectorCheck(snapshot, { css: selector, visible: true });
    for (const node of matches) {
      if (nodeArea(node) <= 1) continue;
      rows.push({
        selector,
        path: String(node.path || ''),
        node,
        area: nodeArea(node),
      });
    }
  }
  rows.sort((a, b) => b.area - a.area);
  return rows[0] || null;
}

async function resolveSelectorTarget(profileId, selector, options = {}) {
  const filterMode = resolveFilterMode(options.filterMode);
  const strictFilter = filterMode !== 'legacy';
  const normalizedSelector = String(selector || '').trim();
  const snapshot = await getDomSnapshotByProfile(profileId);
  const viewport = getSnapshotViewport(snapshot);
  const modal = strictFilter ? resolveActiveModal(snapshot) : null;
  const visibleMatches = buildSelectorCheck(snapshot, { css: normalizedSelector, visible: true });
  const allMatches = strictFilter
    ? visibleMatches
    : buildSelectorCheck(snapshot, { css: normalizedSelector, visible: false });
  const scopedVisible = modal
    ? visibleMatches.filter((item) => isPathWithin(item.path, modal.path))
    : visibleMatches;
  const scopedAll = modal
    ? allMatches.filter((item) => isPathWithin(item.path, modal.path))
    : allMatches;
  const candidate = strictFilter
    ? (scopedVisible[0] || null)
    : (scopedVisible[0] || scopedAll[0] || null);
  if (!candidate) {
    if (modal) {
      throw new Error(`Modal focus locked for selector: ${normalizedSelector}`);
    }
    throw new Error(`Element not found: ${normalizedSelector}`);
  }
  const center = nodeCenter(candidate, viewport);
  if (!center) {
    throw new Error(`Element not found: ${normalizedSelector}`);
  }
  return {
    ok: true,
    selector: normalizedSelector,
    matchedIndex: Math.max(0, scopedAll.indexOf(candidate)),
    center: center.center,
    rawCenter: center.rawCenter,
    rect: center.rect,
    viewport,
    modalLocked: Boolean(modal),
  };
}

async function scrollTargetIntoViewport(profileId, selector, initialTarget, params = {}, options = {}) {
  let target = initialTarget;
  const maxSteps = Math.max(0, Math.min(24, Number(params.maxScrollSteps ?? 8) || 8));
  const settleMs = Math.max(0, Number(params.scrollSettleMs ?? 140) || 140);
  const visibilityMargin = Math.max(0, Number(params.visibilityMargin ?? params.viewportMargin ?? 6) || 6);
  for (let i = 0; i < maxSteps; i += 1) {
    if (isTargetFullyInViewport(target, visibilityMargin)) break;
    const delta = resolveViewportScrollDelta(target, visibilityMargin);
    if (Math.abs(delta.deltaX) < 1 && Math.abs(delta.deltaY) < 1) break;
    const anchorX = clamp(Math.round(Number(target?.center?.x || 0) || 1), 1, Math.max(1, Number(target?.viewport?.width || 1) - 1));
    const anchorY = clamp(Math.round(Number(target?.center?.y || 0) || 1), 1, Math.max(1, Number(target?.viewport?.height || 1) - 1));
    await callAPI('mouse:move', { profileId, x: anchorX, y: anchorY, steps: 1 });
    await callAPI('mouse:wheel', { profileId, deltaX: delta.deltaX, deltaY: delta.deltaY });
    if (settleMs > 0) await sleep(settleMs);
    target = await resolveSelectorTarget(profileId, selector, options);
  }
  return target;
}

async function resolveScrollAnchor(profileId, options = {}) {
  const filterMode = resolveFilterMode(options.filterMode);
  const strictFilter = filterMode !== 'legacy';
  const selector = String(options.selector || '').trim();
  const snapshot = await getDomSnapshotByProfile(profileId);
  const viewport = getSnapshotViewport(snapshot);
  const modal = strictFilter ? resolveActiveModal(snapshot) : null;

  if (selector) {
    const visibleMatches = buildSelectorCheck(snapshot, { css: selector, visible: true });
    const target = visibleMatches[0] || null;
    if (target) {
      if (modal && !isPathWithin(target.path, modal.path)) {
        const modalCenter = nodeCenter(modal.node, viewport);
        if (modalCenter) {
          return {
            ok: true,
            source: 'modal',
            center: modalCenter.center,
            modalLocked: true,
            modalSelector: modal.selector,
            selectorRejectedByModalLock: true,
          };
        }
      } else {
        const targetCenter = nodeCenter(target, viewport);
        if (targetCenter) {
          return {
            ok: true,
            source: 'selector',
            center: targetCenter.center,
            modalLocked: Boolean(modal),
          };
        }
      }
    }
  }

  if (modal) {
    const modalCenter = nodeCenter(modal.node, viewport);
    if (modalCenter) {
      return {
        ok: true,
        source: 'modal',
        center: modalCenter.center,
        modalLocked: true,
        modalSelector: modal.selector,
      };
    }
  }

  const width = Number(viewport.width || 0);
  const height = Number(viewport.height || 0);
  return {
    ok: true,
    source: 'document',
    center: {
      x: width > 1 ? Math.round(width / 2) : 1,
      y: height > 1 ? Math.round(height / 2) : 1,
    },
    modalLocked: false,
  };
}

async function executeSelectorOperation({ profileId, action, operation, params, filterMode }) {
  const selector = maybeSelector({
    profileId,
    containerId: params.containerId || operation?.containerId || null,
    selector: params.selector || operation?.selector || null,
  });
  if (!selector) return asErrorPayload('CONTAINER_NOT_FOUND', `${action} requires selector/containerId`);

  let target = await resolveSelectorTarget(profileId, selector, { filterMode });
  target = await scrollTargetIntoViewport(profileId, selector, target, params, { filterMode });
  const visibilityMargin = Math.max(0, Number(params.visibilityMargin ?? params.viewportMargin ?? 6) || 6);
  const targetFullyVisible = isTargetFullyInViewport(target, visibilityMargin);
  if (action === 'click' && !targetFullyVisible) {
    return asErrorPayload('TARGET_NOT_FULLY_VISIBLE', 'click target is not fully visible after auto scroll', {
      selector,
      target,
      visibilityMargin,
    });
  }

  await callAPI('mouse:move', { profileId, x: target.center.x, y: target.center.y, steps: 2 });

  if (action === 'scroll_into_view') {
    return {
      ok: true,
      code: 'OPERATION_DONE',
      message: 'scroll_into_view done',
      data: { selector, target, targetFullyVisible, visibilityMargin },
    };
  }

  if (action === 'click') {
    const button = String(params.button || 'left').trim() || 'left';
    const clicks = Math.max(1, Number(params.clicks ?? 1) || 1);
    const delay = Number(params.delay);
    const result = await callAPI('mouse:click', {
      profileId,
      x: target.center.x,
      y: target.center.y,
      button,
      clicks,
      ...(Number.isFinite(delay) && delay >= 0 ? { delay } : {}),
    });
    return { ok: true, code: 'OPERATION_DONE', message: 'click done', data: { selector, target, result, targetFullyVisible, visibilityMargin } };
  }

  const text = String(params.text ?? params.value ?? '');
  await callAPI('mouse:click', {
    profileId,
    x: target.center.x,
    y: target.center.y,
    button: 'left',
    clicks: 1,
  });
  const clearBeforeType = params.clear !== false;
  if (clearBeforeType) {
    await callAPI('keyboard:press', {
      profileId,
      key: process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    });
    await callAPI('keyboard:press', { profileId, key: 'Backspace' });
  }
  const delay = Number(params.keyDelayMs ?? params.delay);
  await callAPI('keyboard:type', {
    profileId,
    text,
    ...(Number.isFinite(delay) && delay >= 0 ? { delay } : {}),
  });
  if (params.pressEnter === true) {
    await callAPI('keyboard:press', { profileId, key: 'Enter' });
  }
  return {
    ok: true,
    code: 'OPERATION_DONE',
    message: 'type done',
    data: { selector, target, length: text.length },
  };
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
    const filterMode = resolveFilterMode(
      params.filterMode
      || operation?.filterMode
      || context?.filterMode
      || context?.runtime?.filterMode
      || null,
    );

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
      const anchorSelector = maybeSelector({
        profileId: resolvedProfile,
        containerId: params.containerId || operation?.containerId || null,
        selector: params.selector || operation?.selector || null,
      });
      const anchor = await resolveScrollAnchor(resolvedProfile, {
        selector: anchorSelector,
        filterMode,
      });
      if (anchor?.center?.x && anchor?.center?.y) {
        await callAPI('mouse:move', {
          profileId: resolvedProfile,
          x: Math.max(1, Math.round(Number(anchor.center.x) || 1)),
          y: Math.max(1, Math.round(Number(anchor.center.y) || 1)),
          steps: 2,
        });
      }
      const result = await callAPI('mouse:wheel', { profileId: resolvedProfile, deltaX, deltaY });
      return {
        ok: true,
        code: 'OPERATION_DONE',
        message: 'scroll done',
        data: {
          direction,
          amount,
          deltaX,
          deltaY,
          filterMode,
          anchorSource: String(anchor?.source || 'document'),
          modalLocked: anchor?.modalLocked === true,
          result,
        },
      };
    }

    if (action === 'press_key') {
      const key = String(params.key || params.value || '').trim();
      if (!key) return asErrorPayload('OPERATION_FAILED', 'press_key requires params.key');
      const delay = Number(params.delay);
      const result = await callAPI('keyboard:press', {
        profileId: resolvedProfile,
        key,
        ...(Number.isFinite(delay) && delay >= 0 ? { delay } : {}),
      });
      return { ok: true, code: 'OPERATION_DONE', message: 'press_key done', data: result };
    }

    if (action === 'verify_subscriptions') {
      return executeVerifySubscriptions({ profileId: resolvedProfile, params });
    }

    if (action === 'evaluate') {
      if (!isJsExecutionEnabled()) {
        return asErrorPayload('JS_DISABLED', 'evaluate is disabled by default. Re-run camo command with --js.');
      }
      const script = String(params.script || '').trim();
      if (!script) return asErrorPayload('OPERATION_FAILED', 'evaluate requires params.script');
      const result = await callAPI('evaluate', { profileId: resolvedProfile, script });
      return { ok: true, code: 'OPERATION_DONE', message: 'evaluate done', data: result };
    }

    if (action === 'click' || action === 'type' || action === 'scroll_into_view') {
      return await executeSelectorOperation({
        profileId: resolvedProfile,
        action,
        operation,
        params,
        filterMode,
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
