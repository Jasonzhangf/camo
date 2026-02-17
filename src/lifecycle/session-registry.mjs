#!/usr/bin/env node
/**
 * Session registry - persistent session state management
 * Stores session metadata locally for recovery/reconnection
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SESSION_DIR = path.join(os.homedir(), '.webauto', 'sessions');

function ensureSessionDir() {
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }
}

export function getSessionFile(profileId) {
  return path.join(SESSION_DIR, `${profileId}.json`);
}

export function registerSession(profileId, sessionInfo = {}) {
  ensureSessionDir();
  const sessionFile = getSessionFile(profileId);
  
  const sessionData = {
    profileId,
    pid: process.pid,
    startTime: Date.now(),
    lastSeen: Date.now(),
    status: 'active',
    ...sessionInfo,
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
    const updated = {
      ...existing,
      ...updates,
      lastSeen: Date.now(),
      profileId,
    };
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
