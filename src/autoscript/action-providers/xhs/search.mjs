export function buildSubmitSearchScript(params = {}) {
  const keyword = String(params.keyword || '').trim();
  return `(async () => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const metrics = state.metrics && typeof state.metrics === 'object' ? state.metrics : {};
    state.metrics = metrics;
    metrics.searchCount = Number(metrics.searchCount || 0) + 1;
    metrics.lastSearchAt = new Date().toISOString();
    const input = document.querySelector('#search-input, input.search-input');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('SEARCH_INPUT_NOT_FOUND');
    }
    const targetKeyword = ${JSON.stringify(keyword)};
    if (targetKeyword && input.value !== targetKeyword) {
      input.focus();
      input.value = targetKeyword;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const enterEvent = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    const beforeUrl = window.location.href;
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', enterEvent));
    input.dispatchEvent(new KeyboardEvent('keypress', enterEvent));
    input.dispatchEvent(new KeyboardEvent('keyup', enterEvent));
    const candidates = ['.input-button .search-icon', '.input-button', 'button.min-width-search-icon'];
    let clickedSelector = null;
    for (const selector of candidates) {
      const button = document.querySelector(selector);
      if (!button) continue;
      if (button instanceof HTMLElement) button.scrollIntoView({ behavior: 'auto', block: 'center' });
      await new Promise((resolve) => setTimeout(resolve, 80));
      button.click();
      clickedSelector = selector;
      break;
    }
    const form = input.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
    await new Promise((resolve) => setTimeout(resolve, 320));
    return {
      submitted: true,
      via: clickedSelector || 'enter_or_form_submit',
      beforeUrl,
      afterUrl: window.location.href,
      searchCount: metrics.searchCount,
    };
  })()`;
}

export function buildOpenDetailScript(params = {}) {
  const mode = String(params.mode || 'first').trim().toLowerCase();
  const maxNotes = Math.max(1, Number(params.maxNotes ?? params.limit ?? 20) || 20);
  const keyword = String(params.keyword || '').trim();

  return `(async () => {
    const STATE_KEY = '__camoXhsState';
    const normalizeVisited = (value) => {
      if (!Array.isArray(value)) return [];
      return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    };
    const mergeVisited = (a, b) => Array.from(new Set([
      ...normalizeVisited(a),
      ...normalizeVisited(b),
    ]));
    const loadState = () => {
      const inMemory = window.__camoXhsState && typeof window.__camoXhsState === 'object' ? window.__camoXhsState : {};
      try {
        const stored = localStorage.getItem(STATE_KEY);
        if (!stored) return { ...inMemory };
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object') return { ...inMemory };
        const merged = { ...inMemory, ...parsed };
        merged.visitedNoteIds = mergeVisited(parsed.visitedNoteIds, inMemory.visitedNoteIds);
        return merged;
      } catch {
        return { ...inMemory };
      }
    };
    const saveState = (nextState) => {
      window.__camoXhsState = nextState;
      try { localStorage.setItem(STATE_KEY, JSON.stringify(nextState)); } catch {}
    };

    const state = loadState();
    if (!Array.isArray(state.visitedNoteIds)) state.visitedNoteIds = [];
    state.maxNotes = Number(${maxNotes});
    if (${JSON.stringify(keyword)}) state.keyword = ${JSON.stringify(keyword)};

    if (${JSON.stringify(mode)} === 'next' && state.visitedNoteIds.length >= state.maxNotes) {
      throw new Error('AUTOSCRIPT_DONE_MAX_NOTES');
    }

    const nodes = Array.from(document.querySelectorAll('.note-item'))
      .map((item, index) => {
        const cover = item.querySelector('a.cover');
        if (!cover) return null;
        const href = String(cover.getAttribute('href') || '').trim();
        const noteId = href.split('/').filter(Boolean).pop() || ('idx_' + index);
        return { cover, href, noteId };
      })
      .filter(Boolean);
    if (nodes.length === 0) throw new Error('NO_SEARCH_RESULT_ITEM');

    let next = null;
    if (${JSON.stringify(mode)} === 'next') {
      next = nodes.find((row) => !state.visitedNoteIds.includes(row.noteId));
      if (!next) throw new Error('AUTOSCRIPT_DONE_NO_MORE_NOTES');
    } else {
      next = nodes.find((row) => !state.visitedNoteIds.includes(row.noteId)) || nodes[0];
    }

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
    const isVisible = (node) => {
      if (!node || !(node instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(node);
      if (!style) return false;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1;
    };
    const isDetailReady = () => detailSelectors.some((selector) => isVisible(document.querySelector(selector)));

    next.cover.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 140));
    const beforeUrl = window.location.href;
    next.cover.click();

    let detailReady = false;
    for (let i = 0; i < 60; i += 1) {
      if (isDetailReady()) {
        detailReady = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!detailReady) {
      throw new Error('DETAIL_OPEN_TIMEOUT');
    }
    await new Promise((resolve) => setTimeout(resolve, 220));
    const afterUrl = window.location.href;

    if (!state.visitedNoteIds.includes(next.noteId)) state.visitedNoteIds.push(next.noteId);
    state.currentNoteId = next.noteId;
    state.currentHref = next.href;
    state.lastListUrl = beforeUrl;
    saveState(state);
    return {
      opened: true,
      source: ${JSON.stringify(mode)} === 'next' ? 'open_next_detail' : 'open_first_detail',
      noteId: next.noteId,
      visited: state.visitedNoteIds.length,
      maxNotes: state.maxNotes,
      openByClick: true,
      beforeUrl,
      afterUrl,
    };
  })()`;
}

