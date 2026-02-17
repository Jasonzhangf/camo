export function buildCommentsHarvestScript(params = {}) {
  const maxRounds = Math.max(1, Number(params.maxRounds ?? params.maxScrollRounds ?? 14) || 14);
  const scrollStep = Math.max(120, Number(params.scrollStep ?? 420) || 420);
  const settleMs = Math.max(80, Number(params.settleMs ?? 180) || 180);
  const stallRounds = Math.max(1, Number(params.stallRounds ?? 2) || 2);
  const requireBottom = params.requireBottom !== false;
  const includeComments = params.includeComments !== false;
  const commentsLimit = Math.max(0, Number(params.commentsLimit ?? 0) || 0);
  const recoveryStuckRounds = Math.max(1, Number(params.recoveryStuckRounds ?? 2) || 2);
  const recoveryUpRounds = Math.max(1, Number(params.recoveryUpRounds ?? 2) || 2);
  const recoveryDownRounds = Math.max(1, Number(params.recoveryDownRounds ?? 3) || 3);
  const maxRecoveries = Math.max(0, Number(params.maxRecoveries ?? 3) || 3);
  const recoveryUpStep = Math.max(80, Number(params.recoveryUpStep ?? Math.floor(scrollStep * 0.75)) || Math.floor(scrollStep * 0.75));
  const recoveryDownStep = Math.max(120, Number(params.recoveryDownStep ?? Math.floor(scrollStep * 1.3)) || Math.floor(scrollStep * 1.3));
  const recoveryNoProgressRounds = Math.max(1, Number(params.recoveryNoProgressRounds ?? 3) || 3);
  const progressDiffThreshold = Math.max(2, Number(
    params.progressDiffThreshold ?? Math.max(12, Math.floor(scrollStep * 0.08)),
  ) || Math.max(12, Math.floor(scrollStep * 0.08)));
  const recoveryDownBoostPerAttempt = Math.max(0, Number(params.recoveryDownBoostPerAttempt ?? 1) || 1);
  const maxRecoveryDownBoost = Math.max(0, Number(params.maxRecoveryDownBoost ?? 2) || 2);
  const adaptiveMaxRounds = params.adaptiveMaxRounds !== false;
  const adaptiveExpectedPerRound = Math.max(1, Number(params.adaptiveExpectedPerRound ?? 6) || 6);
  const adaptiveBufferRounds = Math.max(0, Number(params.adaptiveBufferRounds ?? 22) || 22);
  const adaptiveMinBoostRounds = Math.max(0, Number(params.adaptiveMinBoostRounds ?? 36) || 36);
  const adaptiveMaxRoundsCap = Math.max(maxRounds, Number(params.adaptiveMaxRoundsCap ?? 320) || 320);

  return `(async () => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const metricsState = state.metrics && typeof state.metrics === 'object' ? state.metrics : {};
    state.metrics = metricsState;
    metricsState.searchCount = Number(metricsState.searchCount || 0);
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
    const isDetailVisible = () => detailSelectors.some((selector) => isVisible(document.querySelector(selector)));
    const parseCountToken = (raw) => {
      const token = String(raw || '').trim();
      const matched = token.match(/^([0-9]+(?:\\.[0-9]+)?)(万|w|W)?$/);
      if (!matched) return null;
      const base = Number(matched[1]);
      if (!Number.isFinite(base)) return null;
      if (!matched[2]) return Math.round(base);
      return Math.round(base * 10000);
    };
    const readExpectedCommentsCount = () => {
      const scopeSelectors = [
        '.note-detail-mask .interaction-container',
        '.note-detail-mask .comments-container',
        '.note-detail-page .interaction-container',
        '.note-detail-page .comments-container',
        '.note-detail-mask',
        '.note-detail-page',
      ];
      const patterns = [
        /([0-9]+(?:\\.[0-9]+)?(?:万|w|W)?)\\s*条?评论/,
        /评论\\s*([0-9]+(?:\\.[0-9]+)?(?:万|w|W)?)/,
        /共\\s*([0-9]+(?:\\.[0-9]+)?(?:万|w|W)?)\\s*条/,
      ];
      for (const selector of scopeSelectors) {
        const root = document.querySelector(selector);
        if (!root) continue;
        const text = String(root.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!text) continue;
        for (const re of patterns) {
          const matched = text.match(re);
          if (!matched || !matched[1]) continue;
          const parsed = parseCountToken(matched[1]);
          if (Number.isFinite(parsed) && parsed >= 0) return parsed;
        }
      }
      return null;
    };

    const scroller = document.querySelector('.note-scroller')
      || document.querySelector('.comments-el')
      || document.querySelector('.comments-container')
      || document.scrollingElement
      || document.documentElement;
    const readMetrics = () => {
      const target = scroller || document.documentElement;
      return {
        scrollTop: Number(target?.scrollTop || 0),
        scrollHeight: Number(target?.scrollHeight || 0),
        clientHeight: Number(target?.clientHeight || window.innerHeight || 0),
      };
    };
    const commentMap = new Map();
    const collect = (round) => {
      const nodes = Array.from(document.querySelectorAll('.comment-item, [class*="comment-item"]'));
      for (const item of nodes) {
        const textNode = item.querySelector('.content, .comment-content, p');
        const authorNode = item.querySelector('.name, .author, .user-name, [class*="author"], [class*="name"]');
        const text = String((textNode && textNode.textContent) || '').trim();
        const author = String((authorNode && authorNode.textContent) || '').trim();
        if (!text) continue;
        const key = author + '::' + text;
        if (commentMap.has(key)) continue;
        const likeNode = item.querySelector('.like-wrapper, .comment-like, [class*="like"]');
        commentMap.set(key, {
          author,
          text,
          liked: Boolean(likeNode && /like-active/.test(String(likeNode.className || ''))),
          firstSeenRound: round,
        });
      }
    };

    const configuredMaxRounds = Number(${maxRounds});
    const scrollStep = Number(${scrollStep});
    const settleMs = Number(${settleMs});
    const stallRounds = Number(${stallRounds});
    const requireBottom = ${requireBottom ? 'true' : 'false'};
    const includeComments = ${includeComments ? 'true' : 'false'};
    const commentsLimit = Number(${commentsLimit});
    const recoveryStuckRounds = Number(${recoveryStuckRounds});
    const recoveryUpRounds = Number(${recoveryUpRounds});
    const recoveryDownRounds = Number(${recoveryDownRounds});
    const maxRecoveries = Number(${maxRecoveries});
    const recoveryUpStep = Number(${recoveryUpStep});
    const recoveryDownStep = Number(${recoveryDownStep});
    const recoveryNoProgressRounds = Number(${recoveryNoProgressRounds});
    const progressDiffThreshold = Number(${progressDiffThreshold});
    const recoveryDownBoostPerAttempt = Number(${recoveryDownBoostPerAttempt});
    const maxRecoveryDownBoost = Number(${maxRecoveryDownBoost});
    const adaptiveMaxRounds = ${adaptiveMaxRounds ? 'true' : 'false'};
    const adaptiveExpectedPerRound = Number(${adaptiveExpectedPerRound});
    const adaptiveBufferRounds = Number(${adaptiveBufferRounds});
    const adaptiveMinBoostRounds = Number(${adaptiveMinBoostRounds});
    const adaptiveMaxRoundsCap = Number(${adaptiveMaxRoundsCap});
    let maxRounds = configuredMaxRounds;
    let maxRoundsSource = 'configured';
    let budgetExpectedCommentsCount = null;
    const applyAdaptiveRounds = (expectedCommentsCount) => {
      const expected = Number(expectedCommentsCount);
      if (!adaptiveMaxRounds || !Number.isFinite(expected) || expected <= 0) return false;
      const estimatedRounds = Math.ceil(expected / adaptiveExpectedPerRound) + adaptiveBufferRounds;
      if (estimatedRounds <= configuredMaxRounds) return false;
      const boostedRounds = Math.max(configuredMaxRounds + adaptiveMinBoostRounds, estimatedRounds);
      const nextRounds = Math.max(configuredMaxRounds, Math.min(adaptiveMaxRoundsCap, boostedRounds));
      maxRounds = nextRounds;
      maxRoundsSource = 'adaptive_expected_comments';
      budgetExpectedCommentsCount = Math.round(expected);
      return true;
    };
    applyAdaptiveRounds(readExpectedCommentsCount());
    let rounds = 0;
    let reachedBottom = false;
    let exitReason = 'max_rounds_reached';
    let noProgressRounds = 0;
    let noNewCommentsStreak = 0;
    let stalledScrollRounds = 0;
    let noEffectStreak = 0;
    let recoveries = 0;
    let bestRemainingDiff = Number.POSITIVE_INFINITY;
    const recoveryReasonCounts = {
      no_effect: 0,
      no_new_comments: 0,
    };
    const performScroll = async (deltaY, waitMs = settleMs) => {
      if (typeof scroller?.scrollBy === 'function') {
        scroller.scrollBy({ top: deltaY, behavior: 'auto' });
      } else {
        window.scrollBy({ top: deltaY, behavior: 'auto' });
      }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    };

    for (let round = 1; round <= maxRounds; round += 1) {
      rounds = round;
      if (!isDetailVisible()) {
        exitReason = 'detail_hidden';
        break;
      }
      const beforeCount = commentMap.size;
      collect(round);
      if ((budgetExpectedCommentsCount === null || budgetExpectedCommentsCount === undefined) && round <= 6) {
        applyAdaptiveRounds(readExpectedCommentsCount());
      }
      const beforeMetrics = readMetrics();
      const beforeDiff = beforeMetrics.scrollHeight - (beforeMetrics.scrollTop + beforeMetrics.clientHeight);
      if (Number.isFinite(beforeDiff) && beforeDiff >= 0) {
        bestRemainingDiff = Math.min(bestRemainingDiff, beforeDiff);
      }
      if (beforeDiff <= 6) {
        reachedBottom = true;
        exitReason = 'bottom_reached';
        break;
      }

      const prevTop = beforeMetrics.scrollTop;
      if (typeof scroller?.scrollBy === 'function') {
        scroller.scrollBy({ top: scrollStep, behavior: 'auto' });
      } else {
        window.scrollBy({ top: scrollStep, behavior: 'auto' });
      }
      await new Promise((resolve) => setTimeout(resolve, settleMs));
      collect(round);
      let afterMetrics = readMetrics();
      let moved = Math.abs(afterMetrics.scrollTop - prevTop) > 1;
      if (!moved && typeof window.scrollBy === 'function') {
        window.scrollBy({ top: Math.max(120, Math.floor(scrollStep / 2)), behavior: 'auto' });
        await new Promise((resolve) => setTimeout(resolve, settleMs));
        collect(round);
        afterMetrics = readMetrics();
        moved = Math.abs(afterMetrics.scrollTop - prevTop) > 1;
      }
      const increased = commentMap.size > beforeCount;
      const afterDiff = afterMetrics.scrollHeight - (afterMetrics.scrollTop + afterMetrics.clientHeight);
      const diffImproved = Number.isFinite(afterDiff) && Number.isFinite(beforeDiff)
        ? afterDiff <= (beforeDiff - progressDiffThreshold)
        : false;
      const bestImproved = Number.isFinite(afterDiff) && Number.isFinite(bestRemainingDiff)
        ? afterDiff <= (bestRemainingDiff - progressDiffThreshold)
        : false;
      if (Number.isFinite(afterDiff) && afterDiff >= 0) {
        bestRemainingDiff = Math.min(bestRemainingDiff, afterDiff);
      }
      const progressedByScroll = diffImproved || bestImproved;
      const progressed = increased || progressedByScroll;
      if (!progressed) {
        noProgressRounds += 1;
        noNewCommentsStreak += 1;
      } else {
        noProgressRounds = 0;
        noNewCommentsStreak = 0;
      }
      if (!moved) stalledScrollRounds += 1;
      else stalledScrollRounds = 0;
      if (!moved) noEffectStreak += 1;
      else noEffectStreak = 0;
      if (afterDiff <= 6) {
        reachedBottom = true;
        exitReason = 'bottom_reached';
        break;
      }
      let recoveryTrigger = null;
      if (noNewCommentsStreak >= recoveryNoProgressRounds) recoveryTrigger = 'no_new_comments';
      if (!recoveryTrigger && noEffectStreak >= recoveryStuckRounds) recoveryTrigger = 'no_effect';
      if (recoveryTrigger) {
        if (recoveries >= maxRecoveries) {
          exitReason = recoveryTrigger === 'no_new_comments'
            ? 'no_new_comments_after_recovery_budget'
            : 'scroll_stalled_after_recovery';
          break;
        }
        recoveries += 1;
        recoveryReasonCounts[recoveryTrigger] += 1;
        for (let i = 0; i < recoveryUpRounds; i += 1) {
          await performScroll(-recoveryUpStep, settleMs + 120);
          collect(round);
        }
        const downBoost = Math.min(maxRecoveryDownBoost, Math.max(0, recoveries - 1) * recoveryDownBoostPerAttempt);
        const downRounds = recoveryDownRounds + downBoost;
        for (let i = 0; i < downRounds; i += 1) {
          await performScroll(recoveryDownStep, settleMs + 180);
          collect(round);
        }
        const recoveredMetrics = readMetrics();
        const recoveredDiff = recoveredMetrics.scrollHeight - (recoveredMetrics.scrollTop + recoveredMetrics.clientHeight);
        const recoveredDiffImproved = Number.isFinite(recoveredDiff) && Number.isFinite(afterDiff)
          ? recoveredDiff <= (afterDiff - progressDiffThreshold)
          : false;
        const recoveredBestImproved = Number.isFinite(recoveredDiff) && Number.isFinite(bestRemainingDiff)
          ? recoveredDiff <= (bestRemainingDiff - progressDiffThreshold)
          : false;
        if (Number.isFinite(recoveredDiff) && recoveredDiff >= 0) {
          bestRemainingDiff = Math.min(bestRemainingDiff, recoveredDiff);
        }
        if (recoveredDiff <= 6) {
          reachedBottom = true;
          exitReason = 'bottom_reached';
          break;
        }
        if (commentMap.size > beforeCount || recoveredDiffImproved || recoveredBestImproved) {
          noProgressRounds = 0;
          noNewCommentsStreak = 0;
        }
        noEffectStreak = 0;
        stalledScrollRounds = 0;
        continue;
      }
      if (stalledScrollRounds >= stallRounds) {
        exitReason = 'scroll_stalled';
        break;
      }
      if (noProgressRounds >= stallRounds) {
        if (!requireBottom) {
          exitReason = 'no_new_comments';
          break;
        }
      }
      if (round === maxRounds) {
        exitReason = 'max_rounds_reached';
      }
    }

    const comments = Array.from(commentMap.values())
      .sort((a, b) => Number(a.firstSeenRound || 0) - Number(b.firstSeenRound || 0))
      .map((item, index) => ({
        index,
        author: item.author,
        text: item.text,
        liked: item.liked,
      }));
    const metrics = readMetrics();
    const detectedExpectedCommentsCount = readExpectedCommentsCount();
    const expectedCommentsCount = Number.isFinite(Number(detectedExpectedCommentsCount))
      ? Number(detectedExpectedCommentsCount)
      : (Number.isFinite(Number(budgetExpectedCommentsCount)) ? Number(budgetExpectedCommentsCount) : null);
    const commentCoverageRate = Number.isFinite(Number(expectedCommentsCount)) && Number(expectedCommentsCount) > 0
      ? Number(Math.min(1, comments.length / Number(expectedCommentsCount)).toFixed(4))
      : null;

    state.currentComments = comments;
    state.commentsCollectedAt = new Date().toISOString();
    state.lastCommentsHarvest = {
      noteId: state.currentNoteId || null,
      searchCount: Number(metricsState.searchCount || 0),
      collected: comments.length,
      expectedCommentsCount,
      commentCoverageRate,
      recoveries,
      recoveryReasonCounts,
      maxRecoveries,
      recoveryNoProgressRounds,
      reachedBottom,
      exitReason,
      rounds,
      configuredMaxRounds,
      maxRounds,
      maxRoundsSource,
      budgetExpectedCommentsCount,
      scroll: metrics,
      at: state.commentsCollectedAt,
    };
    const payload = {
      noteId: state.currentNoteId || null,
      searchCount: Number(metricsState.searchCount || 0),
      collected: comments.length,
      expectedCommentsCount,
      commentCoverageRate,
      recoveries,
      recoveryReasonCounts,
      maxRecoveries,
      recoveryNoProgressRounds,
      firstComment: comments[0] || null,
      reachedBottom,
      exitReason,
      rounds,
      configuredMaxRounds,
      maxRounds,
      maxRoundsSource,
      budgetExpectedCommentsCount,
      scroll: metrics,
    };
    if (includeComments) {
      const bounded = commentsLimit > 0 ? comments.slice(0, commentsLimit) : comments;
      payload.comments = bounded;
      payload.commentsTruncated = commentsLimit > 0 && comments.length > commentsLimit;
    }
    return payload;
  })()`;
}

export function buildCommentMatchScript(params = {}) {
  const keywords = (Array.isArray(params.keywords || params.matchKeywords)
    ? (params.keywords || params.matchKeywords)
    : String(params.keywords || params.matchKeywords || '').split(','))
    .map((item) => String(item))
    .filter(Boolean);
  const mode = String(params.mode || params.matchMode || 'any');
  const minHits = Math.max(1, Number(params.minHits ?? params.matchMinHits ?? 1) || 1);

  return `(async () => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const rows = Array.isArray(state.currentComments) ? state.currentComments : [];
    const keywords = ${JSON.stringify(keywords)};
    const mode = ${JSON.stringify(mode)};
    const minHits = Number(${minHits});
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
    return { matchCount: matches.length, mode, minHits: Math.max(1, minHits) };
  })()`;
}
