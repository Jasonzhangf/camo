import { callAPI } from '../../../utils/browser-service.mjs';
import { asErrorPayload, extractPageList, normalizeArray } from '../utils.mjs';
import { executeViewportOperation } from './viewport.mjs';

const SHORTCUT_OPEN_TIMEOUT_MS = 2500;
const DEFAULT_API_TIMEOUT_MS = 15000;
const DEFAULT_NAV_TIMEOUT_MS = 25000;
const DEFAULT_VIEWPORT_API_TIMEOUT_MS = 8000;
const DEFAULT_VIEWPORT_SETTLE_MS = 120;
const DEFAULT_VIEWPORT_ATTEMPTS = 1;
const DEFAULT_VIEWPORT_TOLERANCE_PX = 3;
const RUNTIME_LAYER_TIMEOUT_MS = 10000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timer = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function resolveTimeoutMs(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(500, Math.floor(parsed));
}

function resolveViewportSyncConfig({ params = {}, inherited = null }) {
  const enabled = params.syncViewport !== undefined
    ? params.syncViewport !== false
    : inherited?.enabled !== false;
  return {
    enabled,
    apiTimeoutMs: resolveTimeoutMs(
      params.viewportApiTimeoutMs ?? inherited?.apiTimeoutMs,
      DEFAULT_VIEWPORT_API_TIMEOUT_MS,
    ),
    settleMs: Math.max(
      0,
      Number(params.viewportSettleMs ?? inherited?.settleMs ?? DEFAULT_VIEWPORT_SETTLE_MS) || DEFAULT_VIEWPORT_SETTLE_MS,
    ),
    attempts: Math.max(
      1,
      Number(params.viewportAttempts ?? inherited?.attempts ?? DEFAULT_VIEWPORT_ATTEMPTS) || DEFAULT_VIEWPORT_ATTEMPTS,
    ),
    tolerancePx: Math.max(
      0,
      Number(params.viewportTolerancePx ?? inherited?.tolerancePx ?? DEFAULT_VIEWPORT_TOLERANCE_PX) || DEFAULT_VIEWPORT_TOLERANCE_PX,
    ),
  };
}



/**
 * 双重超时保护：在 runtime 层强制超时，即使 fetch 超时失效
 */
async function withRuntimeLayerTimeout(promise, timeoutMs, timeoutMessage) {
  let runtimeTimer = null;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      runtimeTimer = setTimeout(() => {
        console.error(`[RuntimeLayerTimeout] ${timeoutMessage}`);
        reject(new Error(`Runtime layer timeout after ${timeoutMs}ms: ${timeoutMessage}`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (runtimeTimer) clearTimeout(runtimeTimer);
  });
}

/**
 * 带强制 runtime 层超时的 API 调用
 */
async function callApiWithRuntimeTimeout(action, payload, timeoutMs, runtimeTimeoutMs) {
  const effectiveTimeoutMs = resolveTimeoutMs(timeoutMs, DEFAULT_API_TIMEOUT_MS);
  const effectiveRuntimeTimeoutMs = Math.min(effectiveTimeoutMs + 5000, RUNTIME_LAYER_TIMEOUT_MS);

  console.log(`[callApiWithRuntimeTimeout] ${action} timeout: ${effectiveTimeoutMs}ms, runtime: ${effectiveRuntimeTimeoutMs}ms`);

  return withRuntimeLayerTimeout(
    callAPI(action, payload),
    effectiveRuntimeTimeoutMs,
    `${action} runtime timeout after ${effectiveRuntimeTimeoutMs}ms`,
  );
}

async function callApiWithTimeout(action, payload, timeoutMs) {
  const effectiveTimeoutMs = resolveTimeoutMs(timeoutMs, DEFAULT_API_TIMEOUT_MS);
  return withTimeout(
    callAPI(action, payload),
    effectiveTimeoutMs,
    `${action} timeout after ${effectiveTimeoutMs}ms`,
  );
}

async function syncTabViewportIfNeeded({ profileId, syncConfig }) {
  if (!syncConfig?.enabled) {
    return { ok: true, code: 'OPERATION_SKIPPED', message: 'sync viewport disabled' };
  }
  return executeViewportOperation({
    profileId,
    action: 'sync_window_viewport',
    params: {
      followWindow: true,
      settleMs: syncConfig.settleMs,
      attempts: syncConfig.attempts,
      tolerancePx: syncConfig.tolerancePx,
      apiTimeoutMs: syncConfig.apiTimeoutMs,
    },
  });
}

function parseUrl(raw) {
  try {
    return new URL(String(raw || ''));
  } catch {
    return null;
  }
}

function normalizeSeedUrl(rawSeedUrl) {
  const parsed = parseUrl(rawSeedUrl);
  if (!parsed) return String(rawSeedUrl || '').trim();
  const host = String(parsed.hostname || '').toLowerCase();
  const pathname = String(parsed.pathname || '');
  const isXhsHost = host.includes('xiaohongshu.com');
  const isXhsDetailPath = /^\/explore\/[^/]+$/.test(pathname);
  if (isXhsHost && isXhsDetailPath) {
    parsed.pathname = '/explore';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  }
  return parsed.toString();
}

function isXhsDetailUrl(rawUrl) {
  const parsed = parseUrl(rawUrl);
  if (!parsed) return false;
  const host = String(parsed.hostname || '').toLowerCase();
  const pathname = String(parsed.pathname || '');
  return host.includes('xiaohongshu.com') && /^\/explore\/[^/]+$/.test(pathname);
}

async function resolveXhsListUrlFromState(profileId, timeoutMs) {
  try {
    const payload = await callApiWithTimeout('evaluate', {
      profileId,
      script: `(() => {
        const STATE_KEY = '__camoXhsState';
        const safeString = (value) => typeof value === 'string' ? value.trim() : '';
        let state = window.__camoXhsState && typeof window.__camoXhsState === 'object'
          ? window.__camoXhsState
          : null;
        if (!state) {
          try {
            const stored = localStorage.getItem(STATE_KEY);
            if (stored) state = JSON.parse(stored);
          } catch {}
        }
        const lastListUrl = safeString(state?.lastListUrl);
        return { lastListUrl };
      })()`,
    }, timeoutMs);
    const result = payload?.result || payload || {};
    const candidate = String(result?.lastListUrl || '').trim();
    return candidate || null;
  } catch {
    return null;
  }
}

function shouldNavigateToSeed(currentUrl, seedUrl) {
  const current = parseUrl(currentUrl);
  const seed = parseUrl(seedUrl);
  if (!seed) return false;
  if (!current) return true;
  const currentPath = String(current.pathname || '');
  const seedPath = String(seed.pathname || '');
  const currentIsXhsDetail = /^\/explore\/[^/]+$/.test(currentPath);
  if (current.protocol === 'about:') return true;
  if (current.origin !== seed.origin) return true;
  if (seedPath.includes('/search_result') && !currentPath.includes('/search_result')) return true;
  if (seedPath === '/explore' && currentIsXhsDetail) return true;
  if (seedPath.includes('/explore') && !currentPath.includes('/explore') && !currentPath.includes('/search_result')) return true;
  return false;
}

async function seedNewestTabIfNeeded({
  profileId,
  seedUrl,
  openDelayMs,
  apiTimeoutMs,
  navigationTimeoutMs,
  syncConfig,
}) {
  if (!seedUrl) return;
  const listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
  const { pages, activeIndex } = extractPageList(listed);
  const newest = [...pages]
    .filter((page) => Number.isFinite(Number(page?.index)))
    .sort((a, b) => Number(b.index) - Number(a.index))[0];
  if (!newest) return;

  const targetIndex = Number(newest.index);
  if (Number(activeIndex) !== targetIndex) {
    await callApiWithTimeout('page:switch', { profileId, index: targetIndex }, apiTimeoutMs);
  }
  try {
    if (shouldNavigateToSeed(newest.url, seedUrl)) {
      await callApiWithTimeout('goto', { profileId, url: seedUrl }, navigationTimeoutMs);
      if (openDelayMs > 0) await sleep(Math.min(openDelayMs, 1200));
    }
    const syncResult = await syncTabViewportIfNeeded({ profileId, syncConfig });
    if (!syncResult?.ok) {
      throw new Error(syncResult?.message || 'sync_window_viewport failed');
    }
  } catch {
    // Best-effort seeding; failing to navigate/sync shouldn't block tab pool init.
  }
}

async function waitForTabCountIncrease({
  profileId,
  beforeCount,
  apiTimeoutMs,
  maxWaitMs,
  pollMs = 250,
}) {
  const startedAt = Date.now();
  const effectivePollMs = Math.max(80, Number(pollMs) || 250);
  const waitMs = Math.max(400, Number(maxWaitMs) || 4000);
  const listTimeoutMs = Math.max(1000, Math.min(resolveTimeoutMs(apiTimeoutMs, DEFAULT_API_TIMEOUT_MS), 8000));
  let lastError = null;

  while (Date.now() - startedAt <= waitMs) {
    try {
      const pollStartTime = Date.now();
      const listed = await callApiWithRuntimeTimeout('page:list', { profileId }, listTimeoutMs, RUNTIME_LAYER_TIMEOUT_MS);
      console.log(`[waitForTabCountIncrease] page:list took ${Date.now() - pollStartTime}ms`);
      const { pages } = extractPageList(listed);
      if (pages.length > beforeCount) {
        return {
          ok: true,
          elapsedMs: Date.now() - startedAt,
          afterCount: pages.length,
        };
      }
    } catch (err) {
      lastError = err;
    }
    await sleep(effectivePollMs);
  }

  return {
    ok: false,
    elapsedMs: Date.now() - startedAt,
    error: lastError,
  };
}

async function hydrateBlankNewestTab({
  profileId,
  beforeCount,
  seedUrl,
  openDelayMs,
  apiTimeoutMs,
  navigationTimeoutMs,
  tabAppearTimeoutMs,
  syncConfig,
}) {
  if (!seedUrl) {
    return { ok: false, reason: 'missing_seed_url' };
  }
  const listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
  const { pages } = extractPageList(listed);
  const candidates = [...pages]
    .filter((page) => Number.isFinite(Number(page?.index)))
    .sort((a, b) => Number(b.index) - Number(a.index));
  const newest = candidates[0] || null;
  if (!newest) {
    return { ok: false, reason: 'no_pages' };
  }
  const currentCount = pages.length;
  if (currentCount <= beforeCount) {
    return { ok: false, reason: 'count_not_increased' };
  }
  const currentUrl = String(newest.url || '').trim().toLowerCase();
  const isBlank = !currentUrl || currentUrl === 'about:blank';
  if (!isBlank) {
    return { ok: true, reason: 'newest_already_navigated', afterCount: currentCount };
  }
  await callApiWithTimeout('page:switch', { profileId, index: Number(newest.index) }, apiTimeoutMs);
  await callApiWithTimeout('goto', { profileId, url: seedUrl }, navigationTimeoutMs);
  if (openDelayMs > 0) {
    await sleep(Math.min(openDelayMs, 1200));
  }
  const syncResult = await syncTabViewportIfNeeded({ profileId, syncConfig });
  if (!syncResult?.ok) {
    throw new Error(syncResult?.message || 'sync_window_viewport failed');
  }
  const after = await waitForTabCountIncrease({
    profileId,
    beforeCount,
    apiTimeoutMs,
    maxWaitMs: Math.max(1500, Math.min(tabAppearTimeoutMs, 6000)),
  });
  return {
    ok: true,
    reason: 'blank_tab_hydrated',
    afterCount: after?.afterCount || currentCount,
  };
}

async function openTabBestEffort({
  profileId,
  seedUrl,
  seedOnOpen = true,
  shortcutOnly = false,
  openDelayMs,
  beforeCount,
  apiTimeoutMs,
  navigationTimeoutMs,
  shortcutTimeoutMs,
  tabAppearTimeoutMs,
  syncConfig,
}) {
  const waitForTab = async () => waitForTabCountIncrease({
    profileId,
    beforeCount,
    apiTimeoutMs,
    maxWaitMs: tabAppearTimeoutMs,
  });
  const settle = async () => {
    if (openDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, openDelayMs));
    }
  };

  let openError = null;
  const openCommandTimeoutMs = Math.max(
    60000,
    resolveTimeoutMs(apiTimeoutMs, DEFAULT_API_TIMEOUT_MS),
    resolveTimeoutMs(tabAppearTimeoutMs, 0) + Math.max(30000, Math.min(openDelayMs || 0, 20000)),
  );
  const payload = seedOnOpen && seedUrl
    ? { profileId, url: seedUrl }
    : { profileId };
  try {
    await callApiWithTimeout('newPage', payload, openCommandTimeoutMs);
    await settle();
    const newPageOpened = await waitForTab();
    if (newPageOpened.ok) {
      if (seedOnOpen && seedUrl) {
        await seedNewestTabIfNeeded({
          profileId,
          seedUrl,
          openDelayMs,
          apiTimeoutMs,
          navigationTimeoutMs,
          syncConfig,
        });
      }
      return { ok: true, mode: 'newPage', error: null };
    }
    const hydrated = await hydrateBlankNewestTab({
      profileId,
      beforeCount,
      seedUrl,
      openDelayMs,
      apiTimeoutMs,
      navigationTimeoutMs,
      tabAppearTimeoutMs,
      syncConfig,
    }).catch((error) => ({ ok: false, error }));
    if (hydrated?.ok) {
      return { ok: true, mode: 'newPage_hydrated_blank', error: null };
    }
    if (hydrated?.error) {
      openError = hydrated.error;
    }
  } catch (err) {
    openError = err;
  }

  return { ok: false, mode: null, error: openError };
}

export async function executeTabPoolOperation({ profileId, action, params = {}, context = {} }) {
  const runtimeState = context?.runtime && typeof context.runtime === 'object' ? context.runtime : null;

  if (action === 'ensure_tab_pool') {
    const tabCount = Math.max(1, Number(params.tabCount ?? params.count ?? 1) || 1);
    const minOpenDelayMs = Math.max(0, Number(params.minDelayMs ?? params.minOpenDelayMs ?? 0) || 0);
    const openDelayMs = Math.max(
      minOpenDelayMs,
      Math.max(0, Number(params.openDelayMs ?? 350) || 350),
    );
    const normalizeTabs = params.normalizeTabs === true;
    const seedOnOpen = params.seedOnOpen !== false;
    const shortcutOnly = params.shortcutOnly === true;
    const reuseOnly = params.reuseOnly === true;
    const apiTimeoutMs = resolveTimeoutMs(params.apiTimeoutMs, DEFAULT_API_TIMEOUT_MS);
    const navigationTimeoutMs = resolveTimeoutMs(params.navigationTimeoutMs ?? params.gotoTimeoutMs, DEFAULT_NAV_TIMEOUT_MS);
    const shortcutTimeoutMs = resolveTimeoutMs(params.shortcutTimeoutMs, SHORTCUT_OPEN_TIMEOUT_MS);
    const tabAppearTimeoutMs = resolveTimeoutMs(
      params.tabAppearTimeoutMs,
      Math.max(20000, openDelayMs + 15000),
    );
    const syncConfig = resolveViewportSyncConfig({ params });
    const configuredSeedUrl = normalizeSeedUrl(String(params.url || '').trim());

    let listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
    let { pages, activeIndex } = extractPageList(listed);
    const defaultSeedUrl = String(
      configuredSeedUrl
      || pages.find((item) => item?.active)?.url
      || pages[0]?.url
      || '',
    ).trim();
    let fallbackSeedUrl = defaultSeedUrl;
    if (!configuredSeedUrl && isXhsDetailUrl(defaultSeedUrl)) {
      const recoveredListUrl = await resolveXhsListUrlFromState(profileId, apiTimeoutMs);
      if (recoveredListUrl) fallbackSeedUrl = recoveredListUrl;
    }
    fallbackSeedUrl = normalizeSeedUrl(fallbackSeedUrl);
    let openFailures = 0;
    const maxOpenFailures = Math.max(3, tabCount);

    while (pages.length < tabCount) {
      if (reuseOnly) {
        break;
      }
      const beforeCount = pages.length;
      const openResult = await openTabBestEffort({
        profileId,
        seedUrl: fallbackSeedUrl,
        seedOnOpen,
        shortcutOnly,
        openDelayMs,
        beforeCount,
        apiTimeoutMs,
        navigationTimeoutMs,
        shortcutTimeoutMs,
        tabAppearTimeoutMs,
        syncConfig,
      });
      listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
      ({ pages, activeIndex } = extractPageList(listed));
      if (!openResult.ok || pages.length <= beforeCount) {
        openFailures += 1;
        if (openFailures >= maxOpenFailures) {
          return asErrorPayload('OPERATION_FAILED', 'new_tab_failed', {
            tabCount,
            beforeCount,
            afterCount: pages.length,
            seedUrl: fallbackSeedUrl || null,
            mode: openResult.mode || null,
            reason: openResult.error?.message || 'cannot open new tab',
            attempts: openFailures,
          });
        }
        if (openDelayMs > 0) {
          await sleep(Math.min(openDelayMs, 1200));
        } else {
          await sleep(300);
        }
        continue;
      }
    }

    if (reuseOnly && pages.length === 0) {
      return asErrorPayload('TAB_POOL_EMPTY', 'reuse_only_tab_pool_requires_existing_tabs', {
        tabCount,
      });
    }

    const sortedPages = [...pages].sort((a, b) => Number(a.index) - Number(b.index));
    const activePage = sortedPages.find((item) => Number(item.index) === Number(activeIndex)) || null;
    const selected = [
      ...(activePage ? [activePage] : []),
      ...sortedPages.filter((item) => Number(item.index) !== Number(activeIndex)),
    ].slice(0, tabCount);

    const forceNormalizeFromDetail = Boolean(seedOnOpen && !configuredSeedUrl && isXhsDetailUrl(defaultSeedUrl));
    const shouldNormalizeSlots = seedOnOpen && Boolean(fallbackSeedUrl) && (normalizeTabs || forceNormalizeFromDetail);

    if (shouldNormalizeSlots) {
      for (const page of selected) {
        const pageIndex = Number(page.index);
        if (!Number.isFinite(pageIndex)) continue;
        try {
          await callApiWithTimeout('page:switch', { profileId, index: pageIndex }, apiTimeoutMs);
          if (shouldNavigateToSeed(page.url, fallbackSeedUrl)) {
            await callApiWithTimeout('goto', { profileId, url: fallbackSeedUrl }, navigationTimeoutMs);
            if (openDelayMs > 0) await sleep(Math.min(openDelayMs, 1200));
          }
          const syncResult = await syncTabViewportIfNeeded({ profileId, syncConfig });
          if (!syncResult?.ok) {
            throw new Error(syncResult?.message || 'tab viewport sync failed');
          }
        } catch (err) {
          const activePage = selected.find((item) => Number(item.index) === Number(activeIndex)) || selected[0] || null;
          const slots = activePage
            ? [{
              slotIndex: 1,
              tabRealIndex: Number(activePage.index),
              url: String(activePage.url || ''),
            }]
            : [];
          if (runtimeState) {
            runtimeState.tabPool = {
              slots,
              cursor: 0,
              count: slots.length,
              syncConfig,
              apiTimeoutMs,
              initializedAt: new Date().toISOString(),
            };
          }
          return {
            ok: true,
            code: 'OPERATION_DEGRADED',
            message: 'ensure_tab_pool degraded to active tab',
            data: {
              tabCount: slots.length,
              normalized: false,
              degraded: true,
              reason: err?.message || 'page switch failed',
              slots,
              pages: activePage ? [activePage] : [],
            },
          };
        }
      }
      listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
      ({ pages } = extractPageList(listed));
    }

    const refreshedByIndex = new Map(
      pages.map((page) => [Number(page.index), page]),
    );
    const slots = selected.map((page, idx) => ({
      slotIndex: idx + 1,
      tabRealIndex: Number(page.index),
      url: String(refreshedByIndex.get(Number(page.index))?.url || page.url || ''),
    }));

    if (slots.length > 0) {
      try {
        await callApiWithTimeout('page:switch', {
          profileId,
          index: Number(slots[0].tabRealIndex),
        }, apiTimeoutMs);
        const syncResult = await syncTabViewportIfNeeded({ profileId, syncConfig });
        if (!syncResult?.ok) {
          throw new Error(syncResult?.message || 'tab viewport sync failed');
        }
      } catch (err) {
        if (runtimeState) {
          runtimeState.tabPool = {
            slots,
            cursor: 0,
            count: slots.length,
            syncConfig,
            apiTimeoutMs,
            initializedAt: new Date().toISOString(),
          };
        }
        return {
          ok: true,
          code: 'OPERATION_DEGRADED',
          message: 'ensure_tab_pool degraded on final switch',
          data: {
            tabCount: slots.length,
            normalized: false,
            degraded: true,
            reason: err?.message || 'page switch failed',
            slots,
            pages: slots,
          },
        };
      }
    }

    if (runtimeState) {
      runtimeState.tabPool = {
        slots,
        cursor: 0,
        count: slots.length,
        syncConfig,
        apiTimeoutMs,
        initializedAt: new Date().toISOString(),
      };
      runtimeState.currentTab = slots[0]
        ? {
            slotIndex: Number(slots[0].slotIndex),
            tabRealIndex: Number(slots[0].tabRealIndex),
            url: String(slots[0].url || ''),
          }
        : null;
    }

    return {
      ok: true,
      code: 'OPERATION_DONE',
      message: 'ensure_tab_pool done',
      data: {
        tabCount: slots.length,
        normalized: shouldNormalizeSlots,
        slots,
        pages: selected,
      },
    };
  }

  if (action === 'tab_pool_switch_next') {
    const settleMs = Math.max(0, Number(params.settleMs ?? params.waitMs ?? 450) || 450);
    const pool = runtimeState?.tabPool;
    const slots = normalizeArray(pool?.slots);
    if (!runtimeState || slots.length === 0) {
      return asErrorPayload('TAB_POOL_NOT_INITIALIZED', 'tab_pool_switch_next requires ensure_tab_pool first');
    }

    const cursor = Math.max(0, Number(pool.cursor) || 0);
    const selected = slots[cursor % slots.length];
    runtimeState.tabPool.cursor = (cursor + 1) % slots.length;
    const targetIndex = Number(selected.tabRealIndex);
    const apiTimeoutMs = resolveTimeoutMs(params.apiTimeoutMs ?? pool?.apiTimeoutMs, DEFAULT_API_TIMEOUT_MS);
    const syncConfig = resolveViewportSyncConfig({ params, inherited: pool?.syncConfig });

    const beforeList = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
    const { activeIndex: beforeActiveIndex } = extractPageList(beforeList);
    if (Number(beforeActiveIndex) !== targetIndex) {
      await callApiWithTimeout('page:switch', {
        profileId,
        index: targetIndex,
      }, apiTimeoutMs);
      const syncResult = await syncTabViewportIfNeeded({ profileId, syncConfig });
      if (!syncResult?.ok) {
        return asErrorPayload('OPERATION_FAILED', 'tab viewport sync failed', {
          targetIndex,
          syncResult,
        });
      }
    }

    if (settleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    const listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
    const { activeIndex } = extractPageList(listed);
    if (Number(activeIndex) !== targetIndex) {
      return asErrorPayload('OPERATION_FAILED', 'tab_pool_switch_next did not activate target tab', {
        expectedIndex: targetIndex,
        activeIndex,
        selected,
      });
    }
    runtimeState.currentTab = {
      slotIndex: Number(selected.slotIndex),
      tabRealIndex: targetIndex,
      activeIndex,
      url: String(selected.url || ''),
    };

    return {
      ok: true,
      code: 'OPERATION_DONE',
      message: 'tab_pool_switch_next done',
      data: {
        currentTab: runtimeState.currentTab,
        cursor: runtimeState.tabPool.cursor,
        slots,
      },
    };
  }

  if (action === 'tab_pool_switch_slot') {
    const pool = runtimeState?.tabPool;
    const slots = normalizeArray(pool?.slots);
    if (!runtimeState || slots.length === 0) {
      return asErrorPayload('TAB_POOL_NOT_INITIALIZED', 'tab_pool_switch_slot requires ensure_tab_pool first');
    }

    const requestedSlotIndex = Number(params.slotIndex ?? params.slot ?? 1);
    if (!Number.isFinite(requestedSlotIndex) || requestedSlotIndex < 1) {
      return asErrorPayload('OPERATION_FAILED', 'tab_pool_switch_slot requires params.slotIndex >= 1');
    }
    const slot = slots.find((item) => Number(item.slotIndex) === Math.floor(requestedSlotIndex));
    if (!slot) {
      return asErrorPayload('OPERATION_FAILED', `tab_pool slot not found: ${requestedSlotIndex}`);
    }
    const targetIndex = Number(slot.tabRealIndex);
    const apiTimeoutMs = resolveTimeoutMs(params.apiTimeoutMs ?? pool?.apiTimeoutMs, DEFAULT_API_TIMEOUT_MS);
    const syncConfig = resolveViewportSyncConfig({ params, inherited: pool?.syncConfig });

    const beforeList = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
    const { activeIndex: beforeActiveIndex } = extractPageList(beforeList);
    if (Number(beforeActiveIndex) !== targetIndex) {
      await callApiWithTimeout('page:switch', { profileId, index: targetIndex }, apiTimeoutMs);
      const syncResult = await syncTabViewportIfNeeded({ profileId, syncConfig });
      if (!syncResult?.ok) {
        return asErrorPayload('OPERATION_FAILED', 'tab viewport sync failed', {
          targetIndex,
          syncResult,
        });
      }
    }
    const listed = await callApiWithTimeout('page:list', { profileId }, apiTimeoutMs);
    const { activeIndex } = extractPageList(listed);
    if (Number(activeIndex) !== targetIndex) {
      return asErrorPayload('OPERATION_FAILED', 'tab_pool_switch_slot did not activate target tab', {
        expectedIndex: targetIndex,
        activeIndex,
        slot,
      });
    }
    runtimeState.currentTab = {
      slotIndex: Number(slot.slotIndex),
      tabRealIndex: targetIndex,
      activeIndex,
      url: String(slot.url || ''),
    };
    return {
      ok: true,
      code: 'OPERATION_DONE',
      message: 'tab_pool_switch_slot done',
      data: { currentTab: runtimeState.currentTab, slots },
    };
  }

  return asErrorPayload('UNSUPPORTED_OPERATION', `Unsupported tab operation: ${action}`);
}
