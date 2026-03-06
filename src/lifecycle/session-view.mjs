#!/usr/bin/env node
import { listRegisteredSessions } from './session-registry.mjs';

const DEFAULT_HEADLESS_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function computeIdleState(session, now = Date.now()) {
  const headless = session?.headless === true;
  const timeoutMs = headless
    ? (Number.isFinite(Number(session?.idleTimeoutMs)) ? Math.max(0, Number(session.idleTimeoutMs)) : DEFAULT_HEADLESS_IDLE_TIMEOUT_MS)
    : 0;
  const lastAt = Number(session?.lastActivityAt || session?.lastSeen || session?.startTime || now);
  const idleMs = Math.max(0, now - (Number.isFinite(lastAt) ? lastAt : now));
  const idle = headless && timeoutMs > 0 && idleMs >= timeoutMs;
  return { headless, timeoutMs, idleMs, idle };
}

function normalizeLiveSession(session) {
  if (!session) return null;
  const profileId = String(session.profileId || session.session_id || '').trim();
  if (!profileId) return null;
  return {
    profileId,
    sessionId: session.session_id || session.sessionId || profileId,
    url: session.current_url || session.url || null,
    mode: session.mode || null,
    ownerPid: Number(session.owner_pid || session.ownerPid || 0) || null,
    live: true,
    raw: session,
  };
}

export function buildResolvedSessionView(liveSessions = [], registeredSessions = listRegisteredSessions()) {
  const now = Date.now();
  const regMap = new Map(registeredSessions.map((item) => [String(item?.profileId || '').trim(), item]).filter(([key]) => key));
  const liveMap = new Map(liveSessions.map(normalizeLiveSession).filter(Boolean).map((item) => [item.profileId, item]));
  const profileIds = new Set([...liveMap.keys(), ...regMap.keys()]);
  const rows = [];

  for (const profileId of profileIds) {
    const live = liveMap.get(profileId) || null;
    const reg = regMap.get(profileId) || null;
    if (!live && reg && String(reg.status || '').trim() === 'closed') continue;
    const idle = computeIdleState(reg || live || {}, now);
    const registryStatus = reg?.status || null;
    const row = {
      profileId,
      sessionId: live?.sessionId || reg?.sessionId || reg?.instanceId || profileId,
      instanceId: reg?.instanceId || live?.sessionId || profileId,
      alias: reg?.alias || null,
      url: live?.url || reg?.url || null,
      mode: live?.mode || reg?.mode || null,
      ownerPid: live?.ownerPid || Number(reg?.ownerPid || reg?.pid || 0) || null,
      headless: idle.headless,
      idleTimeoutMs: idle.timeoutMs,
      idleMs: idle.idleMs,
      idle: idle.idle,
      live: Boolean(live),
      registered: Boolean(reg),
      orphaned: Boolean(reg) && !live,
      needsRecovery: Boolean(reg) && !live && registryStatus === 'active',
      registryStatus,
      lastSeen: reg?.lastSeen || null,
      lastActivityAt: reg?.lastActivityAt || null,
    };
    rows.push(row);
  }

  return rows.sort((a, b) => String(a.profileId).localeCompare(String(b.profileId)));
}

export function resolveSessionViewByProfile(profileId, liveSessions = [], registeredSessions = listRegisteredSessions()) {
  const id = String(profileId || '').trim();
  if (!id) return null;
  return buildResolvedSessionView(liveSessions, registeredSessions).find((item) => item.profileId === id) || null;
}

