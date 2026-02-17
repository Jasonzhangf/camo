import { asErrorPayload } from '../../container/runtime-core/utils.mjs';
import {
  createEvaluateHandler,
  extractEvaluateResultData,
  evaluateWithScript,
  runEvaluateScript,
} from './xhs/common.mjs';
import { buildCommentsHarvestScript, buildCommentMatchScript } from './xhs/comments.mjs';
import {
  buildCloseDetailScript,
  buildDetailHarvestScript,
  buildExpandRepliesScript,
} from './xhs/detail.mjs';
import {
  buildCommentReplyScript,
  executeCommentLikeOperation,
} from './xhs/interaction.mjs';
import {
  mergeCommentsJsonl,
  resolveXhsOutputContext,
} from './xhs/persistence.mjs';
import { buildOpenDetailScript, buildSubmitSearchScript } from './xhs/search.mjs';

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

async function readXhsRuntimeState(profileId) {
  try {
    const payload = await runEvaluateScript({
      profileId,
      script: buildReadStateScript(),
      highlight: false,
    });
    return extractEvaluateResultData(payload) || {};
  } catch {
    return {};
  }
}

async function handleRaiseError({ params }) {
  const code = String(params.code || params.message || 'AUTOSCRIPT_ABORT').trim();
  return asErrorPayload('OPERATION_FAILED', code || 'AUTOSCRIPT_ABORT');
}

async function executeCommentsHarvestOperation({ profileId, params = {} }) {
  const script = buildCommentsHarvestScript(params);
  const highlight = params.highlight !== false;
  const operationResult = await evaluateWithScript({
    profileId,
    script,
    message: 'xhs_comments_harvest done',
    highlight,
  });

  const payload = extractEvaluateResultData(operationResult.data) || {};
  const shouldPersistComments = params.persistComments === true || params.persistCollectedComments === true;
  const includeComments = params.includeComments !== false;
  const comments = Array.isArray(payload.comments) ? payload.comments : [];

  if (!shouldPersistComments || !includeComments || comments.length === 0) {
    return {
      ...operationResult,
      data: {
        ...payload,
        commentsPath: null,
        commentsAdded: 0,
        commentsTotal: Number(payload.collected || comments.length || 0),
      },
    };
  }

  const state = await readXhsRuntimeState(profileId);
  const output = resolveXhsOutputContext({
    params,
    state,
    noteId: payload.noteId || state.currentNoteId || params.noteId,
  });

  const merged = await mergeCommentsJsonl({
    filePath: output.commentsPath,
    noteId: output.noteId,
    comments,
  });

  return {
    ok: true,
    code: 'OPERATION_DONE',
    message: 'xhs_comments_harvest done',
    data: {
      ...payload,
      commentsPath: merged.filePath,
      commentsAdded: merged.added,
      commentsTotal: merged.total,
      outputNoteDir: output.noteDir,
    },
  };
}

const XHS_ACTION_HANDLERS = {
  raise_error: handleRaiseError,
  xhs_submit_search: createEvaluateHandler('xhs_submit_search done', buildSubmitSearchScript),
  xhs_open_detail: createEvaluateHandler('xhs_open_detail done', buildOpenDetailScript),
  xhs_detail_harvest: createEvaluateHandler('xhs_detail_harvest done', buildDetailHarvestScript),
  xhs_expand_replies: createEvaluateHandler('xhs_expand_replies done', buildExpandRepliesScript),
  xhs_comments_harvest: executeCommentsHarvestOperation,
  xhs_comment_match: createEvaluateHandler('xhs_comment_match done', buildCommentMatchScript),
  xhs_comment_like: executeCommentLikeOperation,
  xhs_comment_reply: createEvaluateHandler('xhs_comment_reply done', buildCommentReplyScript),
  xhs_close_detail: createEvaluateHandler('xhs_close_detail done', buildCloseDetailScript),
};

export function isXhsAutoscriptAction(action) {
  const normalized = String(action || '').trim();
  return normalized === 'raise_error' || normalized.startsWith('xhs_');
}

export async function executeXhsAutoscriptOperation({ profileId, action, params = {} }) {
  const handler = XHS_ACTION_HANDLERS[action];
  if (!handler) {
    return asErrorPayload('UNSUPPORTED_OPERATION', `Unsupported xhs operation: ${action}`);
  }
  return handler({ profileId, params });
}
