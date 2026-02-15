#!/usr/bin/env node
/**
 * Browser session cleanup and resource reclamation
 */
import { BROWSER_SERVICE_URL } from '../utils/config.mjs';

export async function cleanupSession(profileId) {
  try {
    const r = await fetch(`${BROWSER_SERVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', args: { profileId } }),
      signal: AbortSignal.timeout(5000),
    });
    
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw new Error(body?.error || `HTTP ${r.status}`);
    }
    
    return await r.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function forceCleanupSession(profileId) {
  try {
    const r = await fetch(`${BROWSER_SERVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop', args: { profileId, force: true } }),
      signal: AbortSignal.timeout(10000),
    });
    
    return await r.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function shutdownBrowserService() {
  try {
    const r = await fetch(`${BROWSER_SERVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'service:shutdown', args: {} }),
      signal: AbortSignal.timeout(10000),
    });
    
    return await r.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export async function getActiveSessions() {
  try {
    const r = await fetch(`${BROWSER_SERVICE_URL}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'getStatus', args: {} }),
      signal: AbortSignal.timeout(3000),
    });
    
    const body = await r.json();
    return body?.sessions || [];
  } catch (err) {
    return [];
  }
}

export async function cleanupAllSessions() {
  const sessions = await getActiveSessions();
  const results = [];
  
  for (const session of sessions) {
    const result = await cleanupSession(session.profileId);
    results.push({ profileId: session.profileId, ...result });
  }
  
  return results;
}
