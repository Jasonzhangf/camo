#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { callAPI } from '../utils/browser-service.mjs';
import { releaseLock } from './lock.mjs';
import { getSessionInfo, markSessionClosed } from './session-registry.mjs';

const WATCHDOG_DIR = path.join(os.homedir(), '.webauto', 'run', 'camo-watchdogs');

function ensureWatchdogDir() {
  if (!fs.existsSync(WATCHDOG_DIR)) {
    fs.mkdirSync(WATCHDOG_DIR, { recursive: true });
  }
}

function getWatchdogFile(profileId) {
  ensureWatchdogDir();
  return path.join(WATCHDOG_DIR, `${profileId}.json`);
}

function readWatchdogRecord(profileId) {
  const file = getWatchdogFile(profileId);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeWatchdogRecord(profileId, record) {
  const file = getWatchdogFile(profileId);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
}

function removeWatchdogRecord(profileId) {
  const file = getWatchdogFile(profileId);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function isProcessAlive(pid) {
  const target = Number(pid);
  if (!Number.isFinite(target) || target <= 0) return false;
  try {
    process.kill(target, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBlankUrl(url) {
  const text = String(url || '').trim().toLowerCase();
  return text === '' || text === 'about:blank' || text === 'about:blank#blocked';
}

function computeTargetViewportFromWindow(measured) {
  const innerWidth = Math.max(320, Number(measured?.innerWidth || 0) || 0);
  const innerHeight = Math.max(240, Number(measured?.innerHeight || 0) || 0);
  const outerWidth = Math.max(320, Number(measured?.outerWidth || 0) || innerWidth);
  const outerHeight = Math.max(240, Number(measured?.outerHeight || 0) || innerHeight);
  const rawDeltaW = Math.max(0, outerWidth - innerWidth);
  const rawDeltaH = Math.max(0, outerHeight - innerHeight);
  const frameW = rawDeltaW > 400 ? 16 : Math.min(rawDeltaW, 120);
  const frameH = rawDeltaH > 400 ? 88 : Math.min(rawDeltaH, 180);
  return {
    width: Math.max(320, outerWidth - frameW),
    height: Math.max(240, outerHeight - frameH),
    innerWidth,
    innerHeight,
  };
}

async function probeWindowMetrics(profileId) {
  const measured = await callAPI('evaluate', {
    profileId,
    script: '({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight })',
  });
  return measured?.result || {};
}

async function syncViewportWithWindow(profileId, tolerancePx = 3) {
  const measured = await probeWindowMetrics(profileId);
  const target = computeTargetViewportFromWindow(measured);
  const dw = Math.abs(target.innerWidth - target.width);
  const dh = Math.abs(target.innerHeight - target.height);
  if (dw <= tolerancePx && dh <= tolerancePx) return false;
  await callAPI('page:setViewport', {
    profileId,
    width: target.width,
    height: target.height,
  });
  return true;
}

function shouldExitMonitor(profileId) {
  const info = getSessionInfo(profileId);
  return !info || info.status !== 'active';
}

async function cleanupSession(profileId) {
  await callAPI('stop', { profileId }).catch(() => {});
  releaseLock(profileId);
  markSessionClosed(profileId);
}

async function runMonitor(profileId, options = {}) {
  const intervalMs = Math.max(500, Number(options.intervalMs) || 1200);
  const emptyThreshold = Math.max(1, Number(options.emptyThreshold) || 2);
  const blankThreshold = Math.max(1, Number(options.blankThreshold) || 3);
  const viewportSyncIntervalMs = Math.max(500, Number(options.viewportSyncIntervalMs) || 1500);
  let lastViewportSyncAt = 0;

  let seenAnyPage = false;
  let seenNonBlankPage = false;
  let emptyStreak = 0;
  let blankOnlyStreak = 0;

  while (true) {
    if (shouldExitMonitor(profileId)) return;

    let sessions = [];
    try {
      const status = await callAPI('getStatus', {});
      sessions = Array.isArray(status?.sessions) ? status.sessions : [];
    } catch {
      // Service unavailable; exit monitor silently.
      return;
    }

    const liveSession = sessions.find((item) => item?.profileId === profileId);
    if (!liveSession) {
      releaseLock(profileId);
      markSessionClosed(profileId);
      return;
    }

    let pages = [];
    try {
      const listed = await callAPI('page:list', { profileId });
      pages = Array.isArray(listed?.pages) ? listed.pages : [];
    } catch {
      // Session lookup failed in page:list: treat as closed.
      releaseLock(profileId);
      markSessionClosed(profileId);
      return;
    }

    if (pages.length > 0) {
      seenAnyPage = true;
      if (pages.some((item) => !isBlankUrl(item?.url))) {
        seenNonBlankPage = true;
      }
    }

    const blankOnly = pages.length > 0 && pages.every((item) => isBlankUrl(item?.url));

    if (seenAnyPage && pages.length === 0) {
      emptyStreak += 1;
    } else {
      emptyStreak = 0;
    }

    if (seenNonBlankPage && blankOnly) {
      blankOnlyStreak += 1;
    } else {
      blankOnlyStreak = 0;
    }

    if (emptyStreak >= emptyThreshold || blankOnlyStreak >= blankThreshold) {
      await cleanupSession(profileId);
      return;
    }

    const now = Date.now();
    if (pages.length > 0 && now - lastViewportSyncAt >= viewportSyncIntervalMs) {
      lastViewportSyncAt = now;
      await syncViewportWithWindow(profileId).catch(() => {});
    }

    await sleep(intervalMs);
  }
}

export function startSessionWatchdog(profileId) {
  const normalized = String(profileId || '').trim();
  if (!normalized) return { ok: false, reason: 'profile_required' };

  const existing = readWatchdogRecord(normalized);
  if (existing?.pid && isProcessAlive(existing.pid)) {
    return { ok: true, started: false, pid: existing.pid };
  }

  const commandPath = fileURLToPath(new URL('../cli.mjs', import.meta.url));
  const child = spawn(process.execPath, [commandPath, '__session-watchdog', normalized], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CAMO_WATCHDOG_CHILD: '1',
    },
  });
  child.unref();

  const childPid = Number(child.pid);
  if (!Number.isFinite(childPid) || childPid <= 0) {
    return { ok: false, reason: 'spawn_failed' };
  }

  writeWatchdogRecord(normalized, {
    profileId: normalized,
    pid: childPid,
    startedAt: Date.now(),
  });
  return { ok: true, started: true, pid: childPid };
}

export function stopSessionWatchdog(profileId) {
  const normalized = String(profileId || '').trim();
  if (!normalized) return false;
  const record = readWatchdogRecord(normalized);
  if (record?.pid && isProcessAlive(record.pid)) {
    try {
      process.kill(record.pid, 'SIGTERM');
    } catch {
      // Ignore kill failure and still cleanup record.
    }
  }
  removeWatchdogRecord(normalized);
  return true;
}

export function stopAllSessionWatchdogs() {
  ensureWatchdogDir();
  const files = fs.readdirSync(WATCHDOG_DIR).filter((name) => name.endsWith('.json'));
  for (const file of files) {
    const profileId = file.slice(0, -'.json'.length);
    stopSessionWatchdog(profileId);
  }
}

export async function handleSessionWatchdogCommand(args) {
  const profileId = String(args[1] || '').trim();
  if (!profileId) {
    throw new Error('Usage: camo __session-watchdog <profileId>');
  }

  const cleanup = () => removeWatchdogRecord(profileId);
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  try {
    await runMonitor(profileId);
  } finally {
    cleanup();
  }
}
