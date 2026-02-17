import path from 'node:path';
import { normalizeArray } from '../../../container/runtime-core/utils.mjs';
import { callAPI } from '../../../utils/browser-service.mjs';
import {
  extractEvaluateResultData,
  extractScreenshotBase64,
  runEvaluateScript,
} from './common.mjs';
import {
  compileLikeRules,
  matchLikeText,
  normalizeText,
} from './like-rules.mjs';
import {
  appendLikedSignature,
  ensureDir,
  loadLikedSignatures,
  makeLikeSignature,
  mergeCommentsJsonl,
  resolveXhsOutputContext,
  savePngBase64,
  writeJsonFile,
} from './persistence.mjs';

function buildReadStateScript() {
  return `(() => {
    const state = window.__camoXhsState || {};
    return {
      keyword: state.keyword || null,
      currentNoteId: state.currentNoteId || null,
      lastCommentsHarvest: state.lastCommentsHarvest && typeof state.lastCommentsHarvest === 'object'
        ? state.lastCommentsHarvest
        : null,
    };
  })()`;
}

function buildCollectLikeTargetsScript() {
  return `(() => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const rows = [];
    const findLikeControl = (item) => {
      const selectors = [
        '.like-wrapper',
        '.comment-like',
        '.interactions .like-wrapper',
        '.interactions [class*="like"]',
        'button[class*="like"]',
        '[aria-label*="赞"]',
      ];
      for (const selector of selectors) {
        const node = item.querySelector(selector);
        if (node instanceof HTMLElement) return node;
      }
      return null;
    };
    const isAlreadyLiked = (node) => {
      if (!node) return false;
      const className = String(node.className || '').toLowerCase();
      const ariaPressed = String(node.getAttribute?.('aria-pressed') || '').toLowerCase();
      const text = String(node.textContent || '');
      const useNode = node.querySelector('use');
      const useHref = String(useNode?.getAttribute?.('xlink:href') || useNode?.getAttribute?.('href') || '').toLowerCase();
      return className.includes('like-active')
        || ariaPressed === 'true'
        || /已赞|取消赞/.test(text)
        || useHref.includes('liked');
    };
    const readText = (item, selectors) => {
      for (const selector of selectors) {
        const node = item.querySelector(selector);
        const text = String(node?.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text) return text;
      }
      return '';
    };
    const readAttr = (item, attrNames) => {
      for (const attr of attrNames) {
        const value = String(item.getAttribute?.(attr) || '').trim();
        if (value) return value;
      }
      return '';
    };

    const matchedSet = new Set(
      Array.isArray(state.matchedComments)
        ? state.matchedComments.map((row) => Number(row?.index)).filter((index) => Number.isFinite(index))
        : [],
    );
    const items = Array.from(document.querySelectorAll('.comment-item'));
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const text = readText(item, ['.content', '.comment-content', 'p']);
      if (!text) continue;
      const userName = readText(item, ['.name', '.author', '.user-name', '.username', '[class*="author"]', '[class*="name"]']);
      const userId = readAttr(item, ['data-user-id', 'data-userid', 'data-user_id']);
      const timestamp = readText(item, ['.date', '.time', '.timestamp', '[class*="time"]']);
      const likeControl = findLikeControl(item);
      rows.push({
        index,
        text,
        userName,
        userId,
        timestamp,
        hasLikeControl: Boolean(likeControl),
        alreadyLiked: isAlreadyLiked(likeControl),
        matchedByState: matchedSet.has(index),
      });
    }
    return {
      noteId: state.currentNoteId || null,
      matchedByStateCount: matchedSet.size,
      reachedBottom: typeof state.lastCommentsHarvest?.reachedBottom === 'boolean'
        ? state.lastCommentsHarvest.reachedBottom
        : false,
      stopReason: String(state.lastCommentsHarvest?.exitReason || '').trim() || null,
      rows,
    };
  })()`;
}

function buildClickLikeByIndexScript(index, highlight) {
  return `(async () => {
    const idx = Number(${JSON.stringify(index)});
    const items = Array.from(document.querySelectorAll('.comment-item'));
    const item = items[idx];
    if (!item) return { clicked: false, reason: 'comment_item_not_found', index: idx };
    const findLikeControl = (node) => {
      const selectors = [
        '.like-wrapper',
        '.comment-like',
        '.interactions .like-wrapper',
        '.interactions [class*="like"]',
        'button[class*="like"]',
        '[aria-label*="赞"]',
      ];
      for (const selector of selectors) {
        const found = node.querySelector(selector);
        if (found instanceof HTMLElement) return found;
      }
      return null;
    };
    const isAlreadyLiked = (node) => {
      if (!node) return false;
      const className = String(node.className || '').toLowerCase();
      const ariaPressed = String(node.getAttribute?.('aria-pressed') || '').toLowerCase();
      const text = String(node.textContent || '');
      const useNode = node.querySelector('use');
      const useHref = String(useNode?.getAttribute?.('xlink:href') || useNode?.getAttribute?.('href') || '').toLowerCase();
      return className.includes('like-active')
        || ariaPressed === 'true'
        || /已赞|取消赞/.test(text)
        || useHref.includes('liked');
    };

    const likeControl = findLikeControl(item);
    if (!likeControl) return { clicked: false, reason: 'like_control_not_found', index: idx };
    const beforeLiked = isAlreadyLiked(likeControl);
    if (beforeLiked) {
      return { clicked: false, alreadyLiked: true, reason: 'already_liked', index: idx };
    }
    item.scrollIntoView({ behavior: 'auto', block: 'center' });
    likeControl.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (${highlight ? 'true' : 'false'}) {
      const prev = likeControl.style.outline;
      likeControl.style.outline = '2px solid #00d6ff';
      setTimeout(() => { likeControl.style.outline = prev; }, 450);
    }
    likeControl.click();
    await new Promise((resolve) => setTimeout(resolve, 220));
    return {
      clicked: true,
      alreadyLiked: false,
      likedAfter: isAlreadyLiked(likeControl),
      reason: 'clicked',
      index: idx,
    };
  })()`;
}

async function captureScreenshotToFile({ profileId, filePath }) {
  try {
    const payload = await callAPI('screenshot', { profileId, fullPage: false });
    const base64 = extractScreenshotBase64(payload);
    if (!base64) return null;
    return savePngBase64(filePath, base64);
  } catch {
    return null;
  }
}

export async function executeCommentLikeOperation({ profileId, params = {} }) {
  const maxLikes = Math.max(1, Number(params.maxLikes ?? params.maxLikesPerRound ?? 1) || 1);
  const rawKeywords = normalizeArray(params.keywords || params.likeKeywords);
  const rules = compileLikeRules(rawKeywords);
  const highlight = params.highlight !== false;
  const dryRun = params.dryRun === true;
  const saveEvidence = params.saveEvidence !== false;
  const persistLikeState = params.persistLikeState !== false;
  const persistComments = params.persistComments === true || params.persistCollectedComments === true;

  const stateRaw = await runEvaluateScript({
    profileId,
    script: buildReadStateScript(),
    highlight: false,
  });
  const state = extractEvaluateResultData(stateRaw) || {};

  const collectedRaw = await runEvaluateScript({
    profileId,
    script: buildCollectLikeTargetsScript(),
    highlight: false,
  });
  const collected = extractEvaluateResultData(collectedRaw) || {};
  const rows = Array.isArray(collected.rows) ? collected.rows : [];

  const output = resolveXhsOutputContext({
    params,
    state,
    noteId: collected.noteId || state.currentNoteId || params.noteId,
  });
  const evidenceDir = dryRun ? output.virtualLikeEvidenceDir : output.likeEvidenceDir;
  if (saveEvidence) {
    await ensureDir(evidenceDir);
  }

  const likedSignatures = persistLikeState ? await loadLikedSignatures(output.likeStatePath) : new Set();
  const likedComments = [];
  const matchedByStateCount = Number(collected.matchedByStateCount || 0);
  const useStateMatches = matchedByStateCount > 0;

  let hitCount = 0;
  let likedCount = 0;
  let dedupSkipped = 0;
  let alreadyLikedSkipped = 0;
  let missingLikeControl = 0;
  let clickFailed = 0;
  let verifyFailed = 0;

  if (persistComments && rows.length > 0) {
    await mergeCommentsJsonl({
      filePath: output.commentsPath,
      noteId: output.noteId,
      comments: rows,
    }).catch(() => null);
  }

  for (const row of rows) {
    if (likedCount >= maxLikes) break;
    if (!row || typeof row !== 'object') continue;
    const text = normalizeText(row.text);
    if (!text) continue;

    let match = null;
    if (useStateMatches) {
      if (!row.matchedByState) continue;
      match = { ok: true, reason: 'state_match', matchedRule: 'state_match' };
    } else {
      match = matchLikeText(text, rules);
      if (!match.ok) continue;
    }
    hitCount += 1;

    const signature = makeLikeSignature({
      noteId: output.noteId,
      userId: String(row.userId || ''),
      userName: String(row.userName || ''),
      text,
    });

    if (signature && likedSignatures.has(signature)) {
      dedupSkipped += 1;
      continue;
    }

    if (!row.hasLikeControl) {
      missingLikeControl += 1;
      continue;
    }

    if (row.alreadyLiked) {
      alreadyLikedSkipped += 1;
      if (persistLikeState && signature) {
        likedSignatures.add(signature);
        await appendLikedSignature(output.likeStatePath, signature, {
          noteId: output.noteId,
          userId: String(row.userId || ''),
          userName: String(row.userName || ''),
          reason: 'already_liked',
        }).catch(() => null);
      }
      continue;
    }

    if (dryRun) {
      continue;
    }

    const beforePath = saveEvidence
      ? await captureScreenshotToFile({
        profileId,
        filePath: path.join(evidenceDir, `like-before-idx-${String(row.index).padStart(3, '0')}-${Date.now()}.png`),
      })
      : null;

    const clickRaw = await runEvaluateScript({
      profileId,
      script: buildClickLikeByIndexScript(row.index, highlight),
      highlight: false,
    });
    const clickResult = extractEvaluateResultData(clickRaw) || {};

    const afterPath = saveEvidence
      ? await captureScreenshotToFile({
        profileId,
        filePath: path.join(evidenceDir, `like-after-idx-${String(row.index).padStart(3, '0')}-${Date.now()}.png`),
      })
      : null;

    if (clickResult.alreadyLiked) {
      alreadyLikedSkipped += 1;
      if (persistLikeState && signature) {
        likedSignatures.add(signature);
        await appendLikedSignature(output.likeStatePath, signature, {
          noteId: output.noteId,
          userId: String(row.userId || ''),
          userName: String(row.userName || ''),
          reason: 'already_liked_after_click',
        }).catch(() => null);
      }
      continue;
    }

    if (!clickResult.clicked) {
      clickFailed += 1;
      continue;
    }

    if (!clickResult.likedAfter) {
      verifyFailed += 1;
      continue;
    }

    likedCount += 1;
    if (persistLikeState && signature) {
      likedSignatures.add(signature);
      await appendLikedSignature(output.likeStatePath, signature, {
        noteId: output.noteId,
        userId: String(row.userId || ''),
        userName: String(row.userName || ''),
        reason: 'liked',
      }).catch(() => null);
    }
    likedComments.push({
      index: Number(row.index),
      userId: String(row.userId || ''),
      userName: String(row.userName || ''),
      content: text,
      timestamp: String(row.timestamp || ''),
      matchedRule: match.matchedRule || match.reason,
      screenshots: {
        before: beforePath,
        after: afterPath,
      },
    });
  }

  const skippedCount = missingLikeControl + clickFailed + verifyFailed;
  const likedTotal = likedCount + dedupSkipped + alreadyLikedSkipped;
  const hitCheckOk = likedTotal + skippedCount === hitCount;
  const summary = {
    noteId: output.noteId,
    keyword: output.keyword,
    env: output.env,
    likeKeywords: rawKeywords,
    maxLikes,
    scannedCount: rows.length,
    hitCount,
    likedCount,
    skippedCount,
    likedTotal,
    hitCheckOk,
    skippedBreakdown: {
      missingLikeControl,
      clickFailed,
      verifyFailed,
    },
    likedBreakdown: {
      newLikes: likedCount,
      alreadyLiked: alreadyLikedSkipped,
      dedup: dedupSkipped,
    },
    reachedBottom: collected.reachedBottom === true,
    stopReason: String(collected.stopReason || '').trim() || null,
    likedComments,
    ts: new Date().toISOString(),
  };

  let summaryPath = null;
  if (saveEvidence) {
    summaryPath = await writeJsonFile(path.join(evidenceDir, `summary-${Date.now()}.json`), summary).catch(() => null);
  }

  return {
    ok: true,
    code: 'OPERATION_DONE',
    message: 'xhs_comment_like done',
    data: {
      noteId: output.noteId,
      scannedCount: rows.length,
      hitCount,
      likedCount,
      skippedCount,
      likedTotal,
      hitCheckOk,
      dedupSkipped,
      alreadyLikedSkipped,
      missingLikeControl,
      clickFailed,
      verifyFailed,
      likedComments,
      commentsPath: persistComments ? output.commentsPath : null,
      likeStatePath: persistLikeState ? output.likeStatePath : null,
      evidenceDir: saveEvidence ? evidenceDir : null,
      summaryPath,
      reachedBottom: collected.reachedBottom === true,
      stopReason: String(collected.stopReason || '').trim() || null,
    },
  };
}

export function buildCommentReplyScript(params = {}) {
  const replyText = String(params.replyText || '').trim();
  return `(async () => {
    const state = window.__camoXhsState || (window.__camoXhsState = {});
    const replyText = ${JSON.stringify(replyText)};
    const matches = Array.isArray(state.matchedComments) ? state.matchedComments : [];
    if (matches.length === 0) return { typed: false, reason: 'no_match' };
    const index = Number(matches[0].index);
    const nodes = Array.from(document.querySelectorAll('.comment-item'));
    const target = nodes[index];
    if (!target) return { typed: false, reason: 'match_not_visible', index };
    target.scrollIntoView({ behavior: 'auto', block: 'center' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    target.click();
    await new Promise((resolve) => setTimeout(resolve, 120));
    const input = document.querySelector('textarea, input[placeholder*="说点"], [contenteditable="true"]');
    if (!input) return { typed: false, reason: 'reply_input_not_found', index };
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
    if (sendButton) sendButton.click();
    state.lastReply = { typed: true, index, at: new Date().toISOString() };
    return state.lastReply;
  })()`;
}
