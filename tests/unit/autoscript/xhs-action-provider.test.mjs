import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeXhsAutoscriptOperation } from '../../../src/autoscript/action-providers/xhs.mjs';

const originalFetch = global.fetch;

function jsonResponse(payload) {
  return {
    ok: true,
    json: async () => payload,
  };
}

describe('xhs action provider', () => {
  let tempRoot;
  let screenshotBase64;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'camo-xhs-provider-'));
    screenshotBase64 = Buffer.from('fake-png').toString('base64');
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => null);
    }
  });

  it('persists harvested comments to comments.jsonl when enabled', async () => {
    global.fetch = async (url, options) => {
      if (!String(url).includes('/command')) return jsonResponse({});
      const body = JSON.parse(options?.body || '{}');
      const action = body.action;
      const args = body.args || {};
      if (action === 'evaluate') {
        const script = String(args.script || '');
        if (script.includes('commentMap = new Map')) {
          return jsonResponse({
            result: {
              noteId: 'note-a',
              collected: 2,
              comments: [
                { author: 'user1', text: '第一条评论', liked: false },
                { author: 'user2', text: '第二条评论', liked: true },
              ],
            },
          });
        }
        if (script.includes('lastCommentsHarvest')) {
          return jsonResponse({
            result: {
              keyword: 'test-keyword',
              currentNoteId: 'note-a',
              lastCommentsHarvest: { reachedBottom: true, exitReason: 'bottom_reached' },
            },
          });
        }
        return jsonResponse({ result: {} });
      }
      if (action === 'getStatus') {
        return jsonResponse({ sessions: [{ profileId: 'p1', sessionId: 's1' }] });
      }
      return jsonResponse({ ok: true });
    };

    const result = await executeXhsAutoscriptOperation({
      profileId: 'p1',
      action: 'xhs_comments_harvest',
      params: {
        includeComments: true,
        persistComments: true,
        keyword: 'test-keyword',
        env: 'debug',
        outputRoot: tempRoot,
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.commentsAdded, 2);
    assert.strictEqual(result.data.commentsTotal, 2);
    assert.ok(result.data.commentsPath.endsWith(path.join('note-a', 'comments.jsonl')));

    const saved = await fs.readFile(result.data.commentsPath, 'utf8');
    const rows = saved.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].noteId, 'note-a');
    assert.strictEqual(rows[0].content, '第一条评论');
  });

  it('writes like-state and like-evidence summary for comment_like', async () => {
    let clickCalls = 0;
    global.fetch = async (url, options) => {
      if (!String(url).includes('/command')) return jsonResponse({});
      const body = JSON.parse(options?.body || '{}');
      const action = body.action;
      const args = body.args || {};
      if (action === 'evaluate') {
        const script = String(args.script || '');
        if (script.includes('matchedByStateCount') && script.includes('rows.push')) {
          return jsonResponse({
            result: {
              noteId: 'note-b',
              matchedByStateCount: 0,
              reachedBottom: true,
              stopReason: 'bottom_reached',
              rows: [
                {
                  index: 0,
                  text: '这人真敬业',
                  userName: 'u1',
                  userId: 'uid-1',
                  timestamp: 'now',
                  hasLikeControl: true,
                  alreadyLiked: false,
                  matchedByState: false,
                },
                {
                  index: 1,
                  text: '这人真敬业，点赞过了',
                  userName: 'u2',
                  userId: 'uid-2',
                  timestamp: 'now',
                  hasLikeControl: true,
                  alreadyLiked: true,
                  matchedByState: false,
                },
              ],
            },
          });
        }
        if (script.includes('state.lastCommentsHarvest') && script.includes('currentNoteId')) {
          return jsonResponse({
            result: {
              keyword: 'k1',
              currentNoteId: 'note-b',
              lastCommentsHarvest: { reachedBottom: true, exitReason: 'bottom_reached' },
            },
          });
        }
        if (script.includes('comment_item_not_found') && script.includes('like_control_not_found')) {
          clickCalls += 1;
          return jsonResponse({
            result: {
              clicked: true,
              alreadyLiked: false,
              likedAfter: true,
              reason: 'clicked',
              index: 0,
            },
          });
        }
        return jsonResponse({ result: {} });
      }
      if (action === 'screenshot') {
        return jsonResponse({ data: screenshotBase64 });
      }
      if (action === 'getStatus') {
        return jsonResponse({ sessions: [{ profileId: 'p1', sessionId: 's1' }] });
      }
      return jsonResponse({ ok: true });
    };

    const result = await executeXhsAutoscriptOperation({
      profileId: 'p1',
      action: 'xhs_comment_like',
      params: {
        keyword: 'k1',
        env: 'debug',
        outputRoot: tempRoot,
        keywords: ['真敬业'],
        maxLikes: 2,
      },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.data.likedCount, 1);
    assert.strictEqual(result.data.alreadyLikedSkipped, 1);
    assert.strictEqual(clickCalls, 1);
    assert.ok(result.data.likeStatePath.endsWith('.like-state.jsonl'));
    assert.ok(result.data.evidenceDir.includes(path.join('like-evidence', 'note-b')));
    assert.ok(result.data.summaryPath.endsWith('.json'));

    const likeRowsText = await fs.readFile(result.data.likeStatePath, 'utf8');
    const likeRows = likeRowsText.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.strictEqual(likeRows.length, 2);
  });
});
