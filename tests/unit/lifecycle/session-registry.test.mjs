import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  registerSession,
  updateSession,
  getSessionInfo,
  unregisterSession,
  listRegisteredSessions,
  markSessionReconnecting,
  markSessionActive,
  markSessionClosed,
  cleanupStaleSessions,
  recoverSession,
  getSessionFile,
} from '../../../src/lifecycle/session-registry.mjs';

const TEST_PREFIX = 'test-sreg-' + Date.now();

describe('session registry', () => {
  it('should register and read a session', () => {
    const id = TEST_PREFIX + '-1';
    const data = registerSession(id, { sessionId: 'abc' });
    assert.strictEqual(data.profileId, id);
    assert.strictEqual(data.sessionId, 'abc');
    const read = getSessionInfo(id);
    assert.strictEqual(read.profileId, id);
    unregisterSession(id);
  });

  it('should update existing session', () => {
    const id = TEST_PREFIX + '-2';
    registerSession(id, { status: 'active' });
    const updated = updateSession(id, { pageCount: 2 });
    assert.strictEqual(updated.profileId, id);
    assert.strictEqual(updated.pageCount, 2);
    unregisterSession(id);
  });

  it('should create when update called on missing session', () => {
    const id = TEST_PREFIX + '-3';
    const updated = updateSession(id, { foo: 'bar' });
    assert.strictEqual(updated.profileId, id);
    assert.strictEqual(updated.foo, 'bar');
    unregisterSession(id);
  });

  it('should handle corrupted session JSON by re-registering', () => {
    const id = TEST_PREFIX + '-4';
    registerSession(id);
    const file = getSessionFile(id);
    fs.writeFileSync(file, '{bad-json');
    const updated = updateSession(id, { repaired: true });
    assert.strictEqual(updated.profileId, id);
    assert.strictEqual(updated.repaired, true);
    unregisterSession(id);
  });

  it('should return null for corrupted getSessionInfo', () => {
    const id = TEST_PREFIX + '-5';
    registerSession(id);
    const file = getSessionFile(id);
    fs.writeFileSync(file, '{bad-json');
    const info = getSessionInfo(id);
    assert.strictEqual(info, null);
    unregisterSession(id);
  });

  it('should list registered sessions', () => {
    const id = TEST_PREFIX + '-6';
    registerSession(id);
    const sessions = listRegisteredSessions();
    assert.ok(sessions.some((s) => s.profileId === id));
    unregisterSession(id);
  });

  it('should mark reconnecting and active', () => {
    const id = TEST_PREFIX + '-7';
    registerSession(id);
    const rec = markSessionReconnecting(id);
    assert.strictEqual(rec.status, 'reconnecting');
    const act = markSessionActive(id, { sessionId: 'sid' });
    assert.strictEqual(act.status, 'active');
    assert.strictEqual(act.sessionId, 'sid');
    unregisterSession(id);
  });

  it('should mark closed and unregister', () => {
    const id = TEST_PREFIX + '-8';
    registerSession(id);
    const removed = markSessionClosed(id);
    assert.strictEqual(removed, true);
    assert.strictEqual(getSessionInfo(id), null);
  });

  it('should cleanup stale/closed/corrupted sessions', () => {
    const id1 = TEST_PREFIX + '-9';
    const id2 = TEST_PREFIX + '-10';
    const id3 = TEST_PREFIX + '-11';
    registerSession(id1, { status: 'closed' });
    registerSession(id2, { lastSeen: Date.now() - (10 * 24 * 60 * 60 * 1000) });
    registerSession(id3);
    fs.writeFileSync(getSessionFile(id3), '{broken');

    const cleaned = cleanupStaleSessions();
    assert.ok(cleaned >= 2);

    unregisterSession(id1);
    unregisterSession(id2);
    unregisterSession(id3);
  });

  it('should recover session as needs_recovery when health fails', async () => {
    const id = TEST_PREFIX + '-12';
    registerSession(id);
    const res = await recoverSession(id, async () => false);
    assert.strictEqual(res.status, 'needs_recovery');
    unregisterSession(id);
  });

  it('should recover session as recovered when health passes', async () => {
    const id = TEST_PREFIX + '-13';
    registerSession(id);
    const res = await recoverSession(id, async () => true);
    assert.strictEqual(res.status, 'recovered');
    unregisterSession(id);
  });

  it('should return null when recovering missing session', async () => {
    const res = await recoverSession('missing-' + TEST_PREFIX, async () => true);
    assert.strictEqual(res, null);
  });
});
