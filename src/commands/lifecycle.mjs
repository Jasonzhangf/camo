#!/usr/bin/env node
/**
 * Lifecycle commands: cleanup, force-stop, lock management, session recovery
 */
import { getDefaultProfile } from '../utils/config.mjs';
import { callAPI, ensureBrowserService, checkBrowserService } from '../utils/browser-service.mjs';
import { resolveProfileId } from '../utils/args.mjs';
import { acquireLock, getLockInfo, releaseLock, isLocked, cleanupStaleLocks, listActiveLocks } from '../lifecycle/lock.mjs';
import { 
  getSessionInfo, unregisterSession, markSessionClosed, cleanupStaleSessions,
  listRegisteredSessions, registerSession, updateSession
} from '../lifecycle/session-registry.mjs';

export async function handleCleanupCommand(args) {
  const sub = args[1];
  
  if (sub === 'locks') {
    const cleaned = cleanupStaleLocks();
    console.log(JSON.stringify({ ok: true, cleanedStaleLocks: cleaned }, null, 2));
    return;
  }
  
  if (sub === 'sessions') {
    const cleaned = cleanupStaleSessions();
    console.log(JSON.stringify({ ok: true, cleanedStaleSessions: cleaned }, null, 2));
    return;
  }
  
  if (sub === 'all') {
    const serviceUp = await checkBrowserService();
    const results = [];
    
    if (serviceUp) {
      try {
        const status = await callAPI('getStatus', {});
        const sessions = Array.isArray(status?.sessions) ? status.sessions : [];
        
        for (const session of sessions) {
          try {
            await callAPI('stop', { profileId: session.profileId });
            releaseLock(session.profileId);
            markSessionClosed(session.profileId);
            results.push({ profileId: session.profileId, ok: true });
          } catch (err) {
            results.push({ profileId: session.profileId, ok: false, error: err.message });
          }
        }
      } catch {}
    }
    
    // Cleanup stale locks and sessions
    const cleanedLocks = cleanupStaleLocks();
    const cleanedSessions = cleanupStaleSessions();
    
    console.log(JSON.stringify({
      ok: true,
      sessions: results,
      cleanedStaleLocks: cleanedLocks,
      cleanedStaleSessions: cleanedSessions,
    }, null, 2));
    return;
  }
  
  // Clean specific profile
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) {
    throw new Error('Usage: camo cleanup [profileId] | camo cleanup all | camo cleanup locks | camo cleanup sessions');
  }
  
  const serviceUp = await checkBrowserService();
  if (serviceUp) {
    try {
      await callAPI('stop', { profileId });
    } catch {}
  }
  
  releaseLock(profileId);
  markSessionClosed(profileId);
  console.log(JSON.stringify({ ok: true, profileId }, null, 2));
}

export async function handleForceStopCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo force-stop [profileId]');
  
  try {
    const result = await callAPI('stop', { profileId, force: true });
    releaseLock(profileId);
    markSessionClosed(profileId);
    console.log(JSON.stringify({ ok: true, profileId, ...result }, null, 2));
  } catch (err) {
    // Even if stop fails, cleanup local state
    releaseLock(profileId);
    markSessionClosed(profileId);
    console.log(JSON.stringify({ ok: true, profileId, warning: 'Session stopped locally but remote stop failed: ' + err.message }, null, 2));
  }
}

export async function handleLockCommand(args) {
  const sub = args[1];
  
  if (sub === 'list') {
    const locks = listActiveLocks();
    console.log(JSON.stringify({ ok: true, locks, count: locks.length }, null, 2));
    return;
  }
  
  if (sub === 'cleanup') {
    const cleaned = cleanupStaleLocks();
    console.log(JSON.stringify({ ok: true, cleanedStaleLocks: cleaned }, null, 2));
    return;
  }
  
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) {
    throw new Error('Usage: camo lock list | camo lock cleanup | camo lock [profileId]');
  }
  
  const info = getLockInfo(profileId);
  if (!info) {
    console.log(JSON.stringify({ ok: true, locked: false, profileId }, null, 2));
    return;
  }
  
  console.log(JSON.stringify({ ok: true, locked: true, ...info }, null, 2));
}

export async function handleUnlockCommand(args) {
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo unlock [profileId]');
  
  const released = releaseLock(profileId);
  console.log(JSON.stringify({ ok: released, profileId, released }, null, 2));
}

export async function handleSessionsCommand(args) {
  const serviceUp = await checkBrowserService();
  const registeredSessions = listRegisteredSessions();
  
  let liveSessions = [];
  if (serviceUp) {
    try {
      const status = await callAPI('getStatus', {});
      liveSessions = Array.isArray(status?.sessions) ? status.sessions : [];
    } catch {}
  }
  
  // Build a map of live sessions
  const liveMap = new Map(liveSessions.map(s => [s.profileId, s]));
  
  // Merge live and registered sessions
  const merged = [];
  
  // Add all live sessions
  for (const live of liveSessions) {
    const reg = getSessionInfo(live.profileId);
    merged.push({
      profileId: live.profileId,
      sessionId: live.session_id || live.profileId,
      url: live.current_url,
      mode: live.mode,
      live: true,
      registered: !!reg,
      registryStatus: reg?.status,
      lastSeen: reg?.lastSeen,
    });
  }
  
  // Add registered sessions that are not live (orphaned)
  for (const reg of registeredSessions) {
    if (!liveMap.has(reg.profileId) && reg.status !== 'closed') {
      merged.push({
        ...reg,
        live: false,
        orphaned: true,
        needsRecovery: reg.status === 'active',
      });
    }
  }
  
  console.log(JSON.stringify({
    ok: true,
    serviceUp,
    sessions: merged,
    count: merged.length,
    registered: registeredSessions.length,
    live: liveSessions.length,
    orphaned: merged.filter(s => s.orphaned).length,
  }, null, 2));
}

export async function handleRecoverCommand(args) {
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo recover [profileId]');
  
  const reg = getSessionInfo(profileId);
  if (!reg) {
    console.log(JSON.stringify({ ok: false, error: 'No registered session found for profile', profileId }, null, 2));
    return;
  }
  
  const serviceUp = await checkBrowserService();
  
  if (!serviceUp) {
    // Service is down - session cannot be recovered, clean up
    unregisterSession(profileId);
    releaseLock(profileId);
    console.log(JSON.stringify({
      ok: true,
      recovered: false,
      reason: 'browser_service_down',
      profileId,
      message: 'Browser service is down. Session cleaned up. Restart with: camo start ' + profileId,
    }, null, 2));
    return;
  }
  
  // Service is up - check if session is still there
  try {
    const status = await callAPI('getStatus', {});
    const existing = status?.sessions?.find(s => s.profileId === profileId);
    
    if (existing) {
      // Session is alive - update registry
      updateSession(profileId, {
        sessionId: existing.session_id || existing.profileId,
        url: existing.current_url,
        status: 'active',
        recoveredAt: Date.now(),
      });
      acquireLock(profileId, { sessionId: existing.session_id || existing.profileId });
      console.log(JSON.stringify({
        ok: true,
        recovered: true,
        profileId,
        sessionId: existing.session_id || existing.profileId,
        url: existing.current_url,
        message: 'Session reconnected successfully',
      }, null, 2));
    } else {
      // Session not in browser service - clean up
      unregisterSession(profileId);
      releaseLock(profileId);
      console.log(JSON.stringify({
        ok: true,
        recovered: false,
        reason: 'session_not_found',
        profileId,
        message: 'Session not found in browser service. Cleaned up. Restart with: camo start ' + profileId,
      }, null, 2));
    }
  } catch (err) {
    console.log(JSON.stringify({ ok: false, error: err.message, profileId }, null, 2));
  }
}
