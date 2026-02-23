import { describe, it } from 'node:test';
import assert from 'node:assert';
import { buildXhsUnifiedAutoscript } from '../../../src/autoscript/xhs-unified-template.mjs';

describe('xhs unified autoscript template', () => {
  it('builds default template with baseline metadata and guards', () => {
    const script = buildXhsUnifiedAutoscript({});
    assert.strictEqual(script.name, 'xhs-unified-harvest-autoscript');
    assert.strictEqual(script.profileId, 'xiaohongshu-batch-1');
    assert.ok(Array.isArray(script.subscriptions));
    assert.ok(Array.isArray(script.operations));
    assert.ok(script.operations.some((op) => op.id === 'ensure_tab_pool'));
    assert.ok(script.operations.some((op) => op.id === 'switch_tab_round_robin'));
    assert.ok(script.operations.some((op) => op.id === 'verify_subscriptions_all_pages'));
    assert.ok(script.operations.some((op) => op.id === 'open_next_detail' && op.impact === 'script'));
    assert.ok(script.operations.some((op) => op.id === 'abort_on_login_guard'));
    assert.ok(script.operations.some((op) => op.id === 'abort_on_risk_guard'));
    const ensureTabPool = script.operations.find((op) => op.id === 'ensure_tab_pool');
    const submitSearch = script.operations.find((op) => op.id === 'submit_search');
    const openFirst = script.operations.find((op) => op.id === 'open_first_detail');
    const commentsHarvest = script.operations.find((op) => op.id === 'comments_harvest');
    const syncWindow = script.operations.find((op) => op.id === 'sync_window_viewport');
    const switchRoundRobin = script.operations.find((op) => op.id === 'switch_tab_round_robin');
    const waitBetweenNotes = script.operations.find((op) => op.id === 'wait_between_notes');
    assert.strictEqual(ensureTabPool.impact, 'script');
    assert.strictEqual(ensureTabPool.onFailure, 'stop_all');
    assert.deepStrictEqual(ensureTabPool.checkpoint.recovery.actions, []);
    assert.deepStrictEqual(script.defaults.recovery.actions, []);
    assert.strictEqual(script.defaults.timeoutMs, 180000);
    assert.strictEqual(script.defaults.pacing.timeoutMs, 180000);
    assert.strictEqual(submitSearch.action, 'xhs_submit_search');
    assert.strictEqual(openFirst.action, 'xhs_open_detail');
    assert.strictEqual(script.operations.some((op) => op.action === 'evaluate'), false);
    assert.strictEqual(script.throttle, 900);
    assert.strictEqual(syncWindow.action, 'sync_window_viewport');
    assert.strictEqual(syncWindow.params.followWindow, true);
    assert.strictEqual(ensureTabPool.timeoutMs, 180000);
    assert.strictEqual(ensureTabPool.trigger, 'search_result_item.exist');
    assert.strictEqual(waitBetweenNotes.trigger, 'search_result_item.exist');
    assert.strictEqual(switchRoundRobin.timeoutMs, 180000);
    assert.strictEqual(script.metadata.persistComments, true);
    assert.strictEqual(commentsHarvest.params.includeComments, true);
    assert.strictEqual(commentsHarvest.params.recoveryStuckRounds, 2);
    assert.strictEqual(commentsHarvest.params.recoveryUpRounds, 2);
    assert.strictEqual(commentsHarvest.params.recoveryDownRounds, 3);
    assert.strictEqual(commentsHarvest.params.maxRecoveries, 3);
    assert.strictEqual(commentsHarvest.params.recoveryNoProgressRounds, 3);
    assert.strictEqual(commentsHarvest.params.adaptiveMaxRounds, true);
    assert.strictEqual(commentsHarvest.params.adaptiveExpectedPerRound, 6);
    assert.strictEqual(commentsHarvest.params.adaptiveBufferRounds, 22);
    assert.strictEqual(commentsHarvest.params.adaptiveMinBoostRounds, 36);
    assert.strictEqual(commentsHarvest.params.adaptiveMaxRoundsCap, 320);
  });

  it('enables like/reply operations based on options', () => {
    const likesOnly = buildXhsUnifiedAutoscript({
      doLikes: true,
      doReply: false,
      likeKeywords: '好评,推荐',
    });
    const likeOp = likesOnly.operations.find((op) => op.id === 'comment_like');
    const replyOp = likesOnly.operations.find((op) => op.id === 'comment_reply');
    const closeOp = likesOnly.operations.find((op) => op.id === 'close_detail');
    assert.strictEqual(likeOp.enabled, true);
    assert.strictEqual(replyOp.enabled, false);
    assert.deepStrictEqual(closeOp.dependsOn, ['comment_like']);
    assert.deepStrictEqual(likeOp.params.keywords, ['好评', '推荐']);

    const replyEnabled = buildXhsUnifiedAutoscript({
      doLikes: false,
      doReply: true,
      replyText: '谢谢分享',
    });
    const replyEnabledOp = replyEnabled.operations.find((op) => op.id === 'comment_reply');
    const closeReply = replyEnabled.operations.find((op) => op.id === 'close_detail');
    assert.strictEqual(replyEnabledOp.enabled, true);
    assert.deepStrictEqual(closeReply.dependsOn, ['comment_reply']);
    assert.strictEqual(replyEnabledOp.params.replyText, '谢谢分享');

    const likesAndReply = buildXhsUnifiedAutoscript({
      doLikes: true,
      doReply: true,
      likeKeywords: '好评',
      replyText: '谢谢',
    });
    const closeBoth = likesAndReply.operations.find((op) => op.id === 'close_detail');
    assert.deepStrictEqual(closeBoth.dependsOn, ['comment_like', 'comment_reply']);
  });

  it('respects numeric options and keyword defaults', () => {
    const script = buildXhsUnifiedAutoscript({
      profileId: 'p-xhs',
      keyword: '手机壳',
      tabCount: 5,
      noteIntervalMs: 1200,
      maxNotes: 12,
      maxLikesPerRound: 3,
      throttle: 250,
      matchKeywords: '手机壳,耐用',
      matchMode: 'atLeast',
      matchMinHits: 2,
    });
    assert.strictEqual(script.profileId, 'p-xhs');
    assert.strictEqual(script.throttle, 250);
    assert.strictEqual(script.metadata.tabCount, 5);
    assert.strictEqual(script.metadata.noteIntervalMs, 1200);
    assert.strictEqual(script.metadata.maxNotes, 12);
    assert.deepStrictEqual(script.metadata.matchKeywords, ['手机壳', '耐用']);
    const openFirst = script.operations.find((op) => op.id === 'open_first_detail');
    assert.strictEqual(openFirst.params.maxNotes, 12);
  });

  it('allows disabling comment payload persistence in runtime results', () => {
    const script = buildXhsUnifiedAutoscript({
      doComments: true,
      persistComments: false,
    });
    const commentsHarvest = script.operations.find((op) => op.id === 'comments_harvest');
    assert.strictEqual(script.metadata.persistComments, false);
    assert.strictEqual(commentsHarvest.params.includeComments, false);
  });
});
