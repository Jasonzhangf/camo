export function buildDetailHarvestScript() {
  return `(async () => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const scroller = document.querySelector('.note-scroller')
      || document.querySelector('.comments-el')
      || document.scrollingElement
      || document.documentElement;
    for (let i = 0; i < 3; i += 1) {
      scroller.scrollBy({ top: 360, behavior: 'auto' });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const title = (document.querySelector('.note-title') || {}).textContent || '';
    const content = (document.querySelector('.note-content') || {}).textContent || '';
    state.lastDetail = {
      title: String(title).trim().slice(0, 200),
      contentLength: String(content).trim().length,
      capturedAt: new Date().toISOString(),
    };
    return { harvested: true, detail: state.lastDetail };
  })()`;
}

export function buildExpandRepliesScript() {
  return `(async () => {
    const buttons = Array.from(document.querySelectorAll([
      '.note-detail-mask .show-more',
      '.note-detail-mask .reply-expand',
      '.note-detail-mask [class*="expand"]',
      '.note-detail-page .show-more',
      '.note-detail-page .reply-expand',
      '.note-detail-page [class*="expand"]',
    ].join(',')));
    let clicked = 0;
    for (const button of buttons.slice(0, 8)) {
      if (!(button instanceof HTMLElement)) continue;
      const text = (button.textContent || '').trim();
      if (!text) continue;
      button.scrollIntoView({ behavior: 'auto', block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 60));
      button.click();
      clicked += 1;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return { expanded: clicked, scanned: buttons.length };
  })()`;
}

export function buildCloseDetailScript() {
  return `(async () => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const metrics = state.metrics && typeof state.metrics === 'object' ? state.metrics : {};
    state.metrics = metrics;
    metrics.searchCount = Number(metrics.searchCount || 0);
    metrics.rollbackCount = Number(metrics.rollbackCount || 0);
    metrics.returnToSearchCount = Number(metrics.returnToSearchCount || 0);
    const harvest = state.lastCommentsHarvest && typeof state.lastCommentsHarvest === 'object'
      ? state.lastCommentsHarvest
      : null;
    const exitMeta = {
      pageExitReason: String(harvest?.exitReason || 'close_without_harvest').trim(),
      reachedBottom: typeof harvest?.reachedBottom === 'boolean' ? harvest.reachedBottom : null,
      commentsCollected: Number.isFinite(Number(harvest?.collected)) ? Number(harvest.collected) : null,
      expectedCommentsCount: Number.isFinite(Number(harvest?.expectedCommentsCount)) ? Number(harvest.expectedCommentsCount) : null,
      commentCoverageRate: Number.isFinite(Number(harvest?.commentCoverageRate)) ? Number(harvest.commentCoverageRate) : null,
      scrollRecoveries: Number.isFinite(Number(harvest?.recoveries)) ? Number(harvest.recoveries) : 0,
      harvestRounds: Number.isFinite(Number(harvest?.rounds)) ? Number(harvest.rounds) : null,
    };
    const detailSelectors = [
      '.note-detail-mask',
      '.note-detail-page',
      '.note-detail-dialog',
      '.note-detail-mask .detail-container',
      '.note-detail-mask .media-container',
      '.note-detail-mask .note-scroller',
      '.note-detail-mask .note-content',
      '.note-detail-mask .interaction-container',
      '.note-detail-mask .comments-container',
    ];
    const searchSelectors = ['.note-item', '.search-result-list', '#search-input', '.feeds-page'];
    const hasVisible = (selectors) => selectors.some((selector) => {
      const node = document.querySelector(selector);
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    });
    const isDetailVisible = () => hasVisible(detailSelectors);
    const isSearchVisible = () => hasVisible(searchSelectors);
    const dispatchEscape = () => {
      const target = document.activeElement || document.body || document.documentElement;
      const opts = { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true };
      target.dispatchEvent(new KeyboardEvent('keydown', opts));
      target.dispatchEvent(new KeyboardEvent('keyup', opts));
      document.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keyup', opts));
    };
    const waitForCloseAnimation = async () => {
      for (let i = 0; i < 45; i += 1) {
        if (!isDetailVisible() && isSearchVisible()) return true;
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return !isDetailVisible() && isSearchVisible();
    };
    const buildCounterMeta = (returnedToSearch) => ({
      searchCount: Number(metrics.searchCount || 0),
      rollbackCount: Number(metrics.rollbackCount || 0),
      returnToSearchCount: Number(metrics.returnToSearchCount || 0),
      returnedToSearch: Boolean(returnedToSearch),
    });

    if (!isDetailVisible()) {
      return {
        closed: true,
        via: 'already_closed',
        searchVisible: isSearchVisible(),
        ...buildCounterMeta(false),
        ...exitMeta,
      };
    }

    metrics.rollbackCount += 1;
    metrics.lastRollbackAt = new Date().toISOString();

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      dispatchEscape();
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (await waitForCloseAnimation()) {
        const searchVisible = isSearchVisible();
        if (searchVisible) {
          metrics.returnToSearchCount += 1;
          metrics.lastReturnToSearchAt = new Date().toISOString();
        }
        return {
          closed: true,
          via: 'escape',
          attempts: attempt,
          searchVisible,
          ...buildCounterMeta(searchVisible),
          ...exitMeta,
        };
      }
    }

    const selectors = ['.note-detail-mask .close-box', '.note-detail-mask .close-circle', '.close-box', '.close-circle'];
    for (const selector of selectors) {
      const target = document.querySelector(selector);
      if (!target || !(target instanceof HTMLElement)) continue;
      target.scrollIntoView({ behavior: 'auto', block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      target.click();
      await new Promise((resolve) => setTimeout(resolve, 220));
      if (await waitForCloseAnimation()) {
        const searchVisible = isSearchVisible();
        if (searchVisible) {
          metrics.returnToSearchCount += 1;
          metrics.lastReturnToSearchAt = new Date().toISOString();
        }
        return {
          closed: true,
          via: selector,
          attempts: 5,
          searchVisible,
          ...buildCounterMeta(searchVisible),
          ...exitMeta,
        };
      }
    }

    return {
      closed: false,
      via: 'escape_failed',
      detailVisible: isDetailVisible(),
      searchVisible: isSearchVisible(),
      ...buildCounterMeta(false),
      ...exitMeta,
    };
  })()`;
}

