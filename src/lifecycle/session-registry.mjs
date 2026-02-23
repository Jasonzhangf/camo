#!/usr/bin/env node
/**
 * Session registry - persistent session state management
 * Stores session metadata locally for recovery/reconnection
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CONFIG_DIR } from '../utils/config.mjs';

const SESSION_DIR = path.join(CONFIG_DIR, 'sessions');

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

function normalizeAlias(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(text)) {
    throw new Error('Invalid alias. Use only letters, numbers, dot, underscore, dash.');
  }
  return text.slice(0, 64);
}

function normalizeTimeoutMs(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.floor(ms);
}

function generateInstanceId() {
  return `inst_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

export function getSessionFile(profileId) {
  return path.join(SESSION_DIR, `${profileId}.json`);
}

export function registerSession(profileId, sessionInfo = {}) {
  ensureSessionDir();
  const sessionFile = getSessionFile(profileId);
  const now = Date.now();
  const alias = normalizeAlias(sessionInfo.alias);
  const idleTimeoutMs = normalizeTimeoutMs(sessionInfo.idleTimeoutMs);
  const instanceId = String(sessionInfo.instanceId || sessionInfo.sessionId || generateInstanceId()).trim();
  
  const sessionData = {
    profileId,
    pid: process.pid,
    instanceId,
    alias,
    startTime: now,
    lastSeen: now,
    lastActivityAt: now,
    status: 'active',
    ...sessionInfo,
    instanceId,
    alias,
    idleTimeoutMs,
  };
  
  fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
  return sessionData;
}

export function updateSession(profileId, updates = {}) {
  const sessionFile = getSessionFile(profileId);
  if (!fs.existsSync(sessionFile)) {
    return registerSession(profileId, updates);
  }
  
  try {
    const existing = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    const now = Date.now();
    const mergedAlias = Object.prototype.hasOwnProperty.call(updates, 'alias')
      ? normalizeAlias(updates.alias)
      : normalizeAlias(existing.alias);
    const mergedIdleTimeoutMs = Object.prototype.hasOwnProperty.call(updates, 'idleTimeoutMs')
      ? normalizeTimeoutMs(updates.idleTimeoutMs)
      : normalizeTimeoutMs(existing.idleTimeoutMs);
    const touchActivity = updates.touchActivity === true;
    const nextActivityAt = touchActivity
      ? now
      : (Object.prototype.hasOwnProperty.call(updates, 'lastActivityAt')
        ? Number(updates.lastActivityAt) || now
        : Number(existing.lastActivityAt) || now);
    const updated = {
      ...existing,
      ...updates,
      instanceId: String(updates.instanceId || existing.instanceId || updates.sessionId || existing.sessionId || generateInstanceId()).trim(),
      alias: mergedAlias,
      idleTimeoutMs: mergedIdleTimeoutMs,
      lastSeen: now,
      lastActivityAt: nextActivityAt,
      profileId,
    };
    delete updated.touchActivity;
    fs.writeFileSync(sessionFile, JSON.stringify(updated, null, 2));
    return updated;
  } catch {
    return registerSession(profileId, updates);
  }
}

export function getSessionInfo(profileId) {
  const sessionFile = getSessionFile(profileId);
  if (!fs.existsSync(sessionFile)) return null;
  
  try {
    const content = fs.readFileSync(sessionFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function unregisterSession(profileId) {
  const sessionFile = getSessionFile(profileId);
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile);
    return true;
  }
  return false;
}

export function listRegisteredSessions() {
  ensureSessionDir();
  const files = fs.readdirSync(SESSION_DIR);
  const sessions = [];
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const profileId = file.replace('.json', '');
    const info = getSessionInfo(profileId);
    if (info) sessions.push(info);
  }
  
  return sessions;
}

export function findSessionByAlias(alias) {
  const target = normalizeAlias(alias);
  if (!target) return null;
  return listRegisteredSessions().find((item) => normalizeAlias(item?.alias) === target) || null;
}

export function findSessionByInstanceId(instanceId) {
  const target = String(instanceId || '').trim();
  if (!target) return null;
  return listRegisteredSessions().find((item) => String(item?.instanceId || '').trim() === target) || null;
}

export function resolveSessionTarget(target) {
  const value = String(target || '').trim();
  if (!value) return null;
  const sessions = listRegisteredSessions();
  const byProfile = sessions.find((item) => String(item?.profileId || '').trim() === value);
  if (byProfile) return { profileId: byProfile.profileId, reason: 'profile', session: byProfile };
  const byInstanceId = sessions.find((item) => String(item?.instanceId || '').trim() === value);
  if (byInstanceId) return { profileId: byInstanceId.profileId, reason: 'instanceId', session: byInstanceId };
  const byAlias = sessions.find((item) => normalizeAlias(item?.alias) === normalizeAlias(value));
  if (byAlias) return { profileId: byAlias.profileId, reason: 'alias', session: byAlias };
  return null;
}

export function isSessionAliasTaken(alias, exceptProfileId = '') {
  const target = normalizeAlias(alias);
  if (!target) return false;
  const except = String(exceptProfileId || '').trim();
  return listRegisteredSessions().some((item) => {
    if (!item) return false;
    if (except && String(item.profileId || '').trim() === except) return false;
    if (String(item.status || '').trim() !== 'active') return false;
    return normalizeAlias(item.alias) === target;
  });
}

export function touchSessionActivity(profileId, updates = {}) {
  const id = String(profileId || '').trim();
  if (!id) return null;
  const existing = getSessionInfo(id);
  if (!existing) return null;
  return updateSession(id, {
    ...updates,
    touchActivity: true,
  });
}

export function markSessionReconnecting(profileId) {
  return updateSession(profileId, { status: 'reconnecting', reconnectAttempt: Date.now() });
}

export function markSessionActive(profileId, updates = {}) {
  return updateSession(profileId, { status: 'active', ...updates });

}

export function markSessionClosed(profileId) {
  const sessionFile = getSessionFile(profileId);
  if (fs.existsSync(sessionFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      existing.status = 'closed';
      existing.closedAt = Date.now();
      fs.writeFileSync(sessionFile, JSON.stringify(existing, null, 2));
    } catch {
      // Best-effort close: continue with removal even for corrupted metadata.
    }
  }
  return unregisterSession(profileId);
}

export function cleanupStaleSessions(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  ensureSessionDir();
  const files = fs.readdirSync(SESSION_DIR);
  const now = Date.now();
  let cleaned = 0;
  
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    
    const sessionFile = path.join(SESSION_DIR, file);
    try {
      const content = fs.readFileSync(sessionFile, 'utf-8');
      const session = JSON.parse(content);
      
      // Clean if session is too old or marked as closed
      if (session.status === 'closed' || (session.lastSeen && (now - session.lastSeen) > maxAgeMs)) {
        fs.unlinkSync(sessionFile);
        cleaned++;
      }
    } catch {
      // Remove corrupted session files
      try {
        fs.unlinkSync(sessionFile);
        cleaned++;
      } catch {}
    }
  }
  
  return cleaned;
}

export async function recoverSession(profileId, checkHealthFn) {
  const info = getSessionInfo(profileId);
  if (!info) return null;
  
  // Check if browser service is still running
  const isHealthy = await checkHealthFn();
  
  if (!isHealthy) {
    // Service is down, mark as needing recovery
    markSessionReconnecting(profileId);
    return { status: 'needs_recovery', info };
  }
  
  // Service is up, check if session is still active
  markSessionActive(profileId, { recoveredAt: Date.now() });
  return { status: 'recovered', info };
}
