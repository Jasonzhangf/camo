function toTrimmedString(value, fallback = '') {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function toBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function toPositiveInt(value, fallback, min = 1) {
  if (value === null || value === undefined || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.floor(num));
}

function splitCsv(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => toTrimmedString(item))
      .filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function pickCloseDependency(options) {
  if (options.doReply || options.doLikes) return 'comment_match_gate';
  if (options.matchGateEnabled) return 'comment_match_gate';
  if (options.commentsHarvestEnabled) return 'comments_harvest';
  if (options.detailHarvestEnabled) return 'detail_harvest';
  return 'open_first_detail';
}

function buildOpenFirstDetailScript(maxNotes, keyword) {
  return `(async () => {
  const STATE_KEY = '__camoXhsState';
  const loadState = () => {
    const inMemory = window.__camoXhsState && typeof window.__camoXhsState === 'object'
      ? window.__camoXhsState
      : {};
    try {
      const stored = localStorage.getItem(STATE_KEY);
      if (!stored) return { ...inMemory };
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return { ...inMemory };
      return { ...parsed, ...inMemory };
    } catch {
      return { ...inMemory };
    }
  };
  const saveState = (nextState) => {
    window.__camoXhsState = nextState;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
    } catch {}
  };

  const state = loadState();
  if (!Array.isArray(state.visitedNoteIds)) state.visitedNoteIds = [];
  state.maxNotes = Number(${maxNotes});
  state.keyword = ${JSON.stringify(keyword)};

  const nodes = Array.from(document.querySelectorAll('.note-item'))
    .map((item, index) => {
      const cover = item.querySelector('a.cover');
      if (!cover) return null;
      const href = String(cover.getAttribute('href') || '').trim();
      const noteId = href.split('/').filter(Boolean).pop() || ('idx_' + index);
      return { item, cover, href, noteId };
    })
    .filter(Boolean);

  if (nodes.length === 0) {
    throw new Error('NO_SEARCH_RESULT_ITEM');
  }

  const next = nodes.find((row) => !state.visitedNoteIds.includes(row.noteId)) || nodes[0];
  next.cover.scrollIntoView({ behavior: 'auto', block: 'center' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  next.cover.click();
  if (!state.visitedNoteIds.includes(next.noteId)) state.visitedNoteIds.push(next.noteId);
  state.currentNoteId = next.noteId;
  state.currentHref = next.href;
  saveState(state);
  return {
    opened: true,
    source: 'open_first_detail',
    noteId: next.noteId,
    visited: state.visitedNoteIds.length,
    maxNotes: state.maxNotes,
  };
})()`;
}

function buildOpenNextDetailScript(maxNotes) {
  return `(async () => {
  const STATE_KEY = '__camoXhsState';
  const loadState = () => {
    const inMemory = window.__camoXhsState && typeof window.__camoXhsState === 'object'
      ? window.__camoXhsState
      : {};
    try {
      const stored = localStorage.getItem(STATE_KEY);
      if (!stored) return { ...inMemory };
      const parsed = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return { ...inMemory };
      return { ...parsed, ...inMemory };
    } catch {
      return { ...inMemory };
    }
  };
  const saveState = (nextState) => {
    window.__camoXhsState = nextState;
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(nextState));
    } catch {}
  };

  const state = loadState();
  if (!Array.isArray(state.visitedNoteIds)) state.visitedNoteIds = [];
  state.maxNotes = Number(${maxNotes});

  if (state.visitedNoteIds.length >= state.maxNotes) {
    throw new Error('AUTOSCRIPT_DONE_MAX_NOTES');
  }

  const nodes = Array.from(document.querySelectorAll('.note-item'))
    .map((item, index) => {
      const cover = item.querySelector('a.cover');
      if (!cover) return null;
      const href = String(cover.getAttribute('href') || '').trim();
      const noteId = href.split('/').filter(Boolean).pop() || ('idx_' + index);
      return { item, cover, href, noteId };
    })
    .filter(Boolean);

  const next = nodes.find((row) => !state.visitedNoteIds.includes(row.noteId));
  if (!next) {
    throw new Error('AUTOSCRIPT_DONE_NO_MORE_NOTES');
  }

  next.cover.scrollIntoView({ behavior: 'auto', block: 'center' });
  await new Promise((resolve) => setTimeout(resolve, 120));
  next.cover.click();
  state.visitedNoteIds.push(next.noteId);
  state.currentNoteId = next.noteId;
  state.currentHref = next.href;
  saveState(state);
  return {
    opened: true,
    source: 'open_next_detail',
    noteId: next.noteId,
    visited: state.visitedNoteIds.length,
    maxNotes: state.maxNotes,
  };
})()`;
}

function buildSubmitSearchScript(keyword) {
  return `(async () => {
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

  const candidates = [
    '.input-button .search-icon',
    '.input-button',
    'button.min-width-search-icon',
  ];
  let clickedSelector = null;
  for (const selector of candidates) {
    const button = document.querySelector(selector);
    if (!button) continue;
    if (button instanceof HTMLElement) {
      button.scrollIntoView({ behavior: 'auto', block: 'center' });
    }
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
  };
})()`;
}

function buildDetailHarvestScript() {
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

function buildExpandRepliesScript() {
  return `(async () => {
  const buttons = Array.from(document.querySelectorAll('.show-more, .reply-expand, [class*="expand"]'));
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

function buildCommentsHarvestScript() {
  return `(async () => {
  const state = window.__camoXhsState || (window.__camoXhsState = {});
  const comments = Array.from(document.querySelectorAll('.comment-item'))
    .map((item, index) => {
      const textNode = item.querySelector('.content, .comment-content, p');
      const likeNode = item.querySelector('.like-wrapper');
      return {
        index,
        text: String((textNode && textNode.textContent) || '').trim(),
        liked: Boolean(likeNode && /like-active/.test(String(likeNode.className || ''))),
      };
    })
    .filter((row) => row.text);

  state.currentComments = comments;
  state.commentsCollectedAt = new Date().toISOString();
  return {
    collected: comments.length,
    firstComment: comments[0] || null,
  };
})()`;
}

function buildCommentMatchScript(matchKeywords, matchMode, matchMinHits) {
  return `(async () => {
  const state = window.__camoXhsState || (window.__camoXhsState = {});
  const rows = Array.isArray(state.currentComments) ? state.currentComments : [];
  const keywords = ${JSON.stringify(matchKeywords)};
  const mode = ${JSON.stringify(matchMode)};
  const minHits = Number(${matchMinHits});

  const normalize = (value) => String(value || '').toLowerCase().replace(/\\s+/g, ' ').trim();
  const tokens = keywords.map((item) => normalize(item)).filter(Boolean);
  const matches = [];
  for (const row of rows) {
    const text = normalize(row.text);
    if (!text || tokens.length === 0) continue;
    const hits = tokens.filter((token) => text.includes(token));
    if (mode === 'all' && hits.length < tokens.length) continue;
    if (mode === 'atLeast' && hits.length < Math.max(1, minHits)) continue;
    if (mode !== 'all' && mode !== 'atLeast' && hits.length === 0) continue;
    matches.push({ index: row.index, hits });
  }

  state.matchedComments = matches;
  state.matchRule = { tokens, mode, minHits };
  return {
    matchCount: matches.length,
    mode,
    minHits: Math.max(1, minHits),
  };
})()`;
}

function buildCommentLikeScript(likeKeywords, maxLikesPerRound) {
  return `(async () => {
  const state = window.__camoXhsState || (window.__camoXhsState = {});
  const keywords = ${JSON.stringify(likeKeywords)};
  const maxLikes = Number(${maxLikesPerRound});
  const nodes = Array.from(document.querySelectorAll('.comment-item'));
  const matches = Array.isArray(state.matchedComments) ? state.matchedComments : [];
  const targetIndexes = new Set(matches.map((row) => Number(row.index)));

  let likedCount = 0;
  let skippedActive = 0;
  for (let idx = 0; idx < nodes.length; idx += 1) {
    if (likedCount >= maxLikes) break;
    if (targetIndexes.size > 0 && !targetIndexes.has(idx)) continue;
    const item = nodes[idx];
    const text = String((item.querySelector('.content, .comment-content, p') || {}).textContent || '').trim();
    if (!text) continue;
    if (keywords.length > 0) {
      const lower = text.toLowerCase();
      const hit = keywords.some((token) => lower.includes(String(token).toLowerCase()));
      if (!hit) continue;
    }
    const likeWrapper = item.querySelector('.like-wrapper');
    if (!likeWrapper) continue;
    if (/like-active/.test(String(likeWrapper.className || ''))) {
      skippedActive += 1;
      continue;
    }
    likeWrapper.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 90));
    likeWrapper.click();
    likedCount += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  state.lastLike = { likedCount, skippedActive, at: new Date().toISOString() };
  return state.lastLike;
})()`;
}

function buildCommentReplyScript(replyText) {
  return `(async () => {
  const state = window.__camoXhsState || (window.__camoXhsState = {});
  const replyText = ${JSON.stringify(replyText)};
  const matches = Array.isArray(state.matchedComments) ? state.matchedComments : [];
  if (matches.length === 0) {
    return { typed: false, reason: 'no_match' };
  }

  const index = Number(matches[0].index);
  const nodes = Array.from(document.querySelectorAll('.comment-item'));
  const target = nodes[index];
  if (!target) {
    return { typed: false, reason: 'match_not_visible', index };
  }

  target.scrollIntoView({ behavior: 'auto', block: 'center' });
  await new Promise((resolve) => setTimeout(resolve, 100));
  target.click();
  await new Promise((resolve) => setTimeout(resolve, 120));

  const input = document.querySelector('textarea, input[placeholder*="说点"], [contenteditable="true"]');
  if (!input) {
    return { typed: false, reason: 'reply_input_not_found', index };
  }

  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    input.focus();
    input.value = replyText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    input.focus();
    input.textContent = replyText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  await new Promise((resolve) => setTimeout(resolve, 120));
  const sendButton = Array.from(document.querySelectorAll('button'))
    .find((button) => /发送|回复/.test(String(button.textContent || '').trim()));
  if (sendButton) {
    sendButton.click();
  }

  state.lastReply = { typed: true, index, at: new Date().toISOString() };
  return state.lastReply;
})()`;
}

function buildCloseDetailScript() {
  return `(async () => {
  const modalSelectors = [
    '.note-detail-mask',
    '.note-detail',
    '.detail-container',
    '.media-container',
  ];
  const isModalVisible = () => modalSelectors.some((selector) => {
    const node = document.querySelector(selector);
    if (!node || !(node instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(node);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
      return false;
    }
    const rect = node.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  });
  const waitForClosed = async () => {
    for (let i = 0; i < 30; i += 1) {
      if (!isModalVisible()) return true;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return !isModalVisible();
  };

  const selectors = [
    '.note-detail-mask .close-box',
    '.note-detail-mask .close-circle',
    'a[href*="/explore?channel_id=homefeed_recommend"]',
  ];
  for (const selector of selectors) {
    const target = document.querySelector(selector);
    if (!target) continue;
    target.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    target.click();
    return { closed: await waitForClosed(), via: selector };
  }
  if (window.history.length > 1) {
    window.history.back();
    return { closed: await waitForClosed(), via: 'history.back' };
  }
  return { closed: false, via: null, modalVisible: isModalVisible() };
})()`;
}

function buildAbortScript(code) {
  return `(async () => {
  throw new Error(${JSON.stringify(code)});
})()`;
}

export function buildXhsUnifiedAutoscript(rawOptions = {}) {
  const profileId = toTrimmedString(rawOptions.profileId, 'xiaohongshu-batch-1');
  const keyword = toTrimmedString(rawOptions.keyword, '手机膜');
  const env = toTrimmedString(rawOptions.env, 'debug');
  const outputRoot = toTrimmedString(rawOptions.outputRoot, '');
  const throttle = toPositiveInt(rawOptions.throttle, 900, 100);
  const tabCount = toPositiveInt(rawOptions.tabCount, 4, 1);
  const noteIntervalMs = toPositiveInt(rawOptions.noteIntervalMs, 1200, 200);
  const maxNotes = toPositiveInt(rawOptions.maxNotes, 30, 1);
  const maxLikesPerRound = toPositiveInt(rawOptions.maxLikesPerRound, 2, 1);
  const matchMode = toTrimmedString(rawOptions.matchMode, 'any');
  const matchMinHits = toPositiveInt(rawOptions.matchMinHits, 1, 1);
  const replyText = toTrimmedString(rawOptions.replyText, '感谢分享，已关注');

  const doHomepage = toBoolean(rawOptions.doHomepage, true);
  const doImages = toBoolean(rawOptions.doImages, false);
  const doComments = toBoolean(rawOptions.doComments, true);
  const doLikes = toBoolean(rawOptions.doLikes, false);
  const doReply = toBoolean(rawOptions.doReply, false);
  const doOcr = toBoolean(rawOptions.doOcr, false);
  const persistComments = toBoolean(rawOptions.persistComments, true);

  const matchKeywords = splitCsv(rawOptions.matchKeywords || keyword);
  const likeKeywordsSeed = splitCsv(rawOptions.likeKeywords || '');
  const likeKeywords = likeKeywordsSeed.length > 0 ? likeKeywordsSeed : matchKeywords;

  const detailHarvestEnabled = doHomepage || doImages || doComments || doLikes || doReply || doOcr;
  const commentsHarvestEnabled = doComments || doLikes || doReply;
  const matchGateEnabled = doLikes || doReply;
  const closeDependsOn = pickCloseDependency({
    doReply,
    doLikes,
    matchGateEnabled,
    commentsHarvestEnabled,
    detailHarvestEnabled,
  });

  const recovery = {
    attempts: 0,
    actions: [],
  };

  return {
    version: 1,
    name: 'xhs-unified-harvest-autoscript',
    source: '/Users/fanzhang/Documents/github/webauto/scripts/xiaohongshu/phase-unified-harvest.mjs',
    profileId,
    throttle,
    defaults: {
      retry: { attempts: 2, backoffMs: 500 },
      impact: 'subscription',
      onFailure: 'chain_stop',
      validationMode: 'none',
      recovery,
      pacing: {
        operationMinIntervalMs: 700,
        eventCooldownMs: 300,
        jitterMs: 220,
        navigationMinIntervalMs: 1800,
        timeoutMs: 180000,
      },
      timeoutMs: 180000,
    },
    metadata: {
      keyword,
      env,
      outputRoot,
      tabCount,
      noteIntervalMs,
      maxNotes,
      doHomepage,
      doImages,
      doComments,
      doLikes,
      doReply,
      doOcr,
      persistComments,
      matchMode,
      matchMinHits,
      matchKeywords,
      likeKeywords,
      replyText,
      notes: [
        'open_next_detail intentionally stops script by throwing AUTOSCRIPT_DONE_* when exhausted.',
        'dev mode uses deterministic no-recovery policy (checkpoint recovery disabled).',
        'when persistComments=true, xhs_comments_harvest emits full comments in operation result for downstream jsonl/file persistence.',
      ],
    },
    subscriptions: [
      { id: 'home_search_input', selector: '#search-input, input.search-input', events: ['appear', 'exist', 'disappear'] },
      { id: 'home_search_button', selector: '.input-button, .input-button .search-icon', events: ['exist'] },
      { id: 'search_result_item', selector: '.note-item', events: ['appear', 'exist', 'change'] },
      { id: 'detail_modal', selector: '.note-detail-mask, .note-detail-page, .note-detail-dialog, .note-detail-mask .detail-container, .note-detail-mask .media-container, .note-detail-mask .note-scroller, .note-detail-mask .note-content, .note-detail-mask .interaction-container, .note-detail-mask .comments-container', events: ['appear', 'exist', 'disappear'] },
      { id: 'detail_comment_item', selector: '.comment-item, [class*="comment-item"]', events: ['appear', 'exist', 'change'] },
      { id: 'detail_show_more', selector: '.note-detail-mask .show-more, .note-detail-mask .reply-expand, .note-detail-mask [class*="expand"], .note-detail-page .show-more, .note-detail-page .reply-expand, .note-detail-page [class*="expand"]', events: ['appear', 'exist'] },
      { id: 'detail_discover_button', selector: 'a[href*="/explore?channel_id=homefeed_recommend"]', events: ['appear', 'exist'] },
      { id: 'login_guard', selector: '.login-container, .login-dialog, #login-container', events: ['appear', 'exist'] },
      { id: 'risk_guard', selector: '.qrcode-box, .captcha-container, [class*="captcha"]', events: ['appear', 'exist'] },
    ],
    operations: [
      {
        id: 'sync_window_viewport',
        action: 'sync_window_viewport',
        params: { followWindow: true, settleMs: 220, attempts: 2 },
        trigger: 'startup',
        once: true,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'op',
        onFailure: 'continue',
      },
      {
        id: 'goto_home',
        action: 'goto',
        params: { url: 'https://www.xiaohongshu.com/explore' },
        trigger: 'startup',
        dependsOn: ['sync_window_viewport'],
        once: true,
        retry: { attempts: 2, backoffMs: 300 },
        validation: {
          mode: 'post',
          post: {
            page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['home_ready', 'search_ready'] },
          },
        },
        checkpoint: {
          containerId: 'xiaohongshu_home.discover_button',
          targetCheckpoint: 'home_ready',
          recovery,
        },
      },
      {
        id: 'fill_keyword',
        action: 'type',
        params: { selector: '#search-input', text: keyword },
        trigger: 'home_search_input.exist',
        dependsOn: ['goto_home'],
        once: true,
        validation: {
          mode: 'both',
          pre: { page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['home_ready', 'search_ready'] } },
          post: { container: { selector: '#search-input', mustExist: true, minCount: 1 } },
        },
        checkpoint: {
          containerId: 'xiaohongshu_home.search_input',
          targetCheckpoint: 'search_ready',
          recovery,
        },
      },
      {
        id: 'submit_search',
        action: 'xhs_submit_search',
        params: { keyword },
        trigger: 'home_search_input.exist',
        dependsOn: ['fill_keyword'],
        once: true,
        timeoutMs: 120000,
        validation: {
          mode: 'post',
          post: { page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['search_ready', 'home_ready'] } },
        },
        checkpoint: {
          containerId: 'xiaohongshu_home.search_button',
          targetCheckpoint: 'search_ready',
          recovery,
        },
      },
      {
        id: 'open_first_detail',
        action: 'xhs_open_detail',
        params: { mode: 'first', maxNotes, keyword },
        trigger: 'search_result_item.exist',
        dependsOn: ['submit_search'],
        once: true,
        timeoutMs: 90000,
        validation: {
          mode: 'post',
          post: { page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['detail_ready', 'comments_ready', 'search_ready'] } },
        },
        checkpoint: {
          containerId: 'xiaohongshu_search.search_result_item',
          targetCheckpoint: 'detail_ready',
          recovery,
        },
      },
      {
        id: 'detail_harvest',
        enabled: detailHarvestEnabled,
        action: 'xhs_detail_harvest',
        params: {},
        trigger: 'detail_modal.exist',
        dependsOn: ['open_first_detail'],
        once: false,
        oncePerAppear: true,
        timeoutMs: 90000,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'op',
        onFailure: 'continue',
        pacing: { operationMinIntervalMs: 2000, eventCooldownMs: 1200, jitterMs: 260 },
        validation: {
          mode: 'both',
          pre: {
            page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['detail_ready', 'comments_ready'] },
            container: { selector: '.note-detail-mask, .note-detail-page, .note-detail-dialog', mustExist: true, minCount: 1 },
          },
          post: {
            page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['detail_ready', 'comments_ready'] },
            container: { selector: '.note-content, .note-scroller, .media-container', mustExist: true, minCount: 1 },
          },
        },
        checkpoint: {
          containerId: 'xiaohongshu_detail.modal_shell',
          targetCheckpoint: 'detail_ready',
          recovery,
        },
      },
      {
        id: 'expand_replies',
        enabled: commentsHarvestEnabled,
        action: 'xhs_expand_replies',
        params: {},
        trigger: 'detail_show_more.exist',
        dependsOn: [detailHarvestEnabled ? 'detail_harvest' : 'open_first_detail'],
        conditions: [{ type: 'subscription_exist', subscriptionId: 'detail_modal' }],
        once: false,
        oncePerAppear: true,
        retry: { attempts: 1, backoffMs: 0 },
        onFailure: 'continue',
        impact: 'op',
        pacing: { operationMinIntervalMs: 2500, eventCooldownMs: 1500, jitterMs: 220 },
      },
      {
        id: 'comments_harvest',
        enabled: commentsHarvestEnabled,
        action: 'xhs_comments_harvest',
        params: {
          env,
          keyword,
          outputRoot,
          persistComments,
          maxRounds: 48,
          scrollStep: 360,
          settleMs: 260,
          stallRounds: 8,
          recoveryNoProgressRounds: 3,
          recoveryStuckRounds: 2,
          recoveryUpRounds: 2,
          recoveryDownRounds: 3,
          maxRecoveries: 3,
          adaptiveMaxRounds: true,
          adaptiveExpectedPerRound: 6,
          adaptiveBufferRounds: 22,
          adaptiveMinBoostRounds: 36,
          adaptiveMaxRoundsCap: 320,
          requireBottom: true,
          includeComments: persistComments,
        },
        trigger: 'detail_modal.exist',
        dependsOn: [detailHarvestEnabled ? 'detail_harvest' : 'open_first_detail'],
        once: false,
        oncePerAppear: true,
        timeoutMs: 90000,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'op',
        onFailure: 'continue',
        pacing: { operationMinIntervalMs: 2400, eventCooldownMs: 1500, jitterMs: 280 },
        validation: {
          mode: 'both',
          pre: {
            page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['detail_ready', 'comments_ready'] },
            container: { selector: '.note-detail-mask, .note-detail-page, .note-detail-dialog', mustExist: true, minCount: 1 },
          },
          post: {
            page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['detail_ready', 'comments_ready'] },
            container: { selector: '.comment-item, [class*="comment-item"]', mustExist: false, minCount: 0 },
          },
        },
        checkpoint: {
          containerId: 'xiaohongshu_detail.comment_section.comment_item',
          targetCheckpoint: 'comments_ready',
          recovery,
        },
      },
      {
        id: 'comment_match_gate',
        enabled: matchGateEnabled,
        action: 'xhs_comment_match',
        params: { keywords: matchKeywords, mode: matchMode, minHits: matchMinHits },
        trigger: 'detail_modal.exist',
        dependsOn: [commentsHarvestEnabled ? 'comments_harvest' : (detailHarvestEnabled ? 'detail_harvest' : 'open_first_detail')],
        once: false,
        oncePerAppear: true,
        pacing: { operationMinIntervalMs: 2400, eventCooldownMs: 1200, jitterMs: 160 },
      },
      {
        id: 'comment_like',
        enabled: doLikes,
        action: 'xhs_comment_like',
        params: {
          env,
          keyword,
          outputRoot,
          persistLikeState: true,
          saveEvidence: true,
          keywords: likeKeywords,
          maxLikes: maxLikesPerRound,
        },
        trigger: 'detail_modal.exist',
        dependsOn: ['comment_match_gate'],
        once: false,
        oncePerAppear: true,
        timeoutMs: 90000,
        retry: { attempts: 1, backoffMs: 0 },
        onFailure: 'continue',
        impact: 'op',
        pacing: { operationMinIntervalMs: 2600, eventCooldownMs: 1500, jitterMs: 300 },
      },
      {
        id: 'comment_reply',
        enabled: doReply,
        action: 'xhs_comment_reply',
        params: { replyText },
        trigger: 'detail_modal.exist',
        dependsOn: ['comment_match_gate'],
        once: false,
        oncePerAppear: true,
        timeoutMs: 90000,
        retry: { attempts: 1, backoffMs: 0 },
        onFailure: 'continue',
        impact: 'op',
        pacing: { operationMinIntervalMs: 2600, eventCooldownMs: 1500, jitterMs: 300 },
      },
      {
        id: 'close_detail',
        action: 'xhs_close_detail',
        params: {},
        trigger: 'detail_modal.exist',
        dependsOn: [closeDependsOn],
        once: false,
        oncePerAppear: true,
        pacing: { operationMinIntervalMs: 2500, eventCooldownMs: 1300, jitterMs: 180 },
        validation: {
          mode: 'post',
          post: { page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['home_ready', 'search_ready'] } },
        },
        checkpoint: {
          containerId: 'xiaohongshu_detail.discover_button',
          targetCheckpoint: 'search_ready',
          recovery,
        },
      },
      {
        id: 'wait_between_notes',
        action: 'wait',
        params: { ms: noteIntervalMs },
        trigger: 'search_result_item.exist',
        dependsOn: ['close_detail'],
        once: false,
        oncePerAppear: true,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'op',
        onFailure: 'continue',
        pacing: { operationMinIntervalMs: noteIntervalMs, eventCooldownMs: Math.max(400, Math.floor(noteIntervalMs / 2)), jitterMs: 160 },
      },
      {
        id: 'switch_tab_round_robin',
        action: 'tab_pool_switch_next',
        params: { settleMs: 450 },
        trigger: 'search_result_item.exist',
        dependsOn: ['wait_between_notes', 'ensure_tab_pool'],
        once: false,
        oncePerAppear: true,
        timeoutMs: 180000,
        retry: { attempts: 2, backoffMs: 500 },
        impact: 'op',
        onFailure: 'continue',
      },
      {
        id: 'open_next_detail',
        action: 'xhs_open_detail',
        params: { mode: 'next', maxNotes },
        trigger: 'search_result_item.exist',
        dependsOn: ['switch_tab_round_robin'],
        once: false,
        oncePerAppear: true,
        timeoutMs: 90000,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'script',
        onFailure: 'stop_all',
        checkpoint: {
          containerId: 'xiaohongshu_search.search_result_item',
          targetCheckpoint: 'detail_ready',
          recovery: { attempts: 0, actions: [] },
        },
      },
      {
        id: 'abort_on_login_guard',
        action: 'raise_error',
        params: { code: 'LOGIN_GUARD_DETECTED' },
        trigger: 'login_guard.appear',
        once: false,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'script',
        onFailure: 'stop_all',
        checkpoint: {
          containerId: 'xiaohongshu_login.login_guard',
          targetCheckpoint: 'login_guard',
          recovery: { attempts: 0, actions: [] },
        },
      },
      {
        id: 'abort_on_risk_guard',
        action: 'raise_error',
        params: { code: 'RISK_CONTROL_DETECTED' },
        trigger: 'risk_guard.appear',
        once: false,
        retry: { attempts: 1, backoffMs: 0 },
        impact: 'script',
        onFailure: 'stop_all',
        checkpoint: {
          containerId: 'xiaohongshu_login.qrcode_guard',
          targetCheckpoint: 'risk_control',
          recovery: { attempts: 0, actions: [] },
        },
      },
      {
        id: 'ensure_tab_pool',
        action: 'ensure_tab_pool',
        params: {
          tabCount,
          openDelayMs: 1200,
          normalizeTabs: false,
        },
        trigger: 'search_result_item.exist',
        dependsOn: ['wait_between_notes'],
        once: true,
        timeoutMs: 180000,
        retry: { attempts: 2, backoffMs: 500 },
        impact: 'script',
        onFailure: 'stop_all',
        validation: {
          mode: 'post',
          post: { page: { hostIncludes: ['xiaohongshu.com'], checkpointIn: ['search_ready', 'home_ready'] } },
        },
        checkpoint: {
          targetCheckpoint: 'search_ready',
          recovery: {
            attempts: 0,
            actions: [],
          },
        },
      },
      {
        id: 'verify_subscriptions_all_pages',
        action: 'verify_subscriptions',
        params: {
          acrossPages: true,
          settleMs: 320,
          selectors: [
            { id: 'home_search_input', selector: '#search-input, input.search-input' },
            { id: 'search_result_item', selector: '.note-item', visible: false, minCount: 1 },
          ],
        },
        trigger: 'search_result_item.exist',
        dependsOn: ['ensure_tab_pool'],
        once: true,
        timeoutMs: 90000,
        impact: 'script',
        onFailure: 'stop_all',
      },
    ],
  };
}
