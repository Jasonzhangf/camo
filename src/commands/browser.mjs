import fs from 'node:fs';
import {
  listProfiles,
  getDefaultProfile,
  getProfileWindowSize,
  setProfileWindowSize,
} from '../utils/config.mjs';
import { callAPI, ensureCamoufox, ensureBrowserService, getSessionByProfile, checkBrowserService } from '../utils/browser-service.mjs';
import { resolveProfileId, ensureUrlScheme, looksLikeUrlToken, getPositionals } from '../utils/args.mjs';
import { acquireLock, releaseLock, cleanupStaleLocks } from '../lifecycle/lock.mjs';
import {
  buildSelectorClickScript,
  buildSelectorTypeScript,
} from '../container/runtime-core/operations/selector-scripts.mjs';
import {
  registerSession,
  updateSession,
  getSessionInfo,
  unregisterSession,
  listRegisteredSessions,
  markSessionClosed,
  cleanupStaleSessions,
  resolveSessionTarget,
  isSessionAliasTaken,
} from '../lifecycle/session-registry.mjs';
import { startSessionWatchdog, stopAllSessionWatchdogs, stopSessionWatchdog } from '../lifecycle/session-watchdog.mjs';

const START_WINDOW_MIN_WIDTH = 960;
const START_WINDOW_MIN_HEIGHT = 700;
const START_WINDOW_MAX_RESERVE = 240;
const START_WINDOW_DEFAULT_RESERVE = 72;
const DEFAULT_HEADLESS_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEVTOOLS_SHORTCUTS = process.platform === 'darwin'
  ? ['Meta+Alt+I', 'F12']
  : ['F12', 'Control+Shift+I'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function parseDurationMs(raw, fallbackMs) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallbackMs;
  const text = String(raw).trim().toLowerCase();
  if (text === '0' || text === 'off' || text === 'none' || text === 'disable' || text === 'disabled') return 0;
  const matched = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!matched) {
    throw new Error('Invalid --idle-timeout. Use forms like 30m, 1800s, 5000ms, 1h, 0');
  }
  const value = Number(matched[1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Invalid --idle-timeout value');
  }
  const unit = matched[2] || 'm';
  const factor = unit === 'h' ? 3600000 : unit === 'm' ? 60000 : unit === 's' ? 1000 : 1;
  return Math.floor(value * factor);
}

function validateAlias(alias) {
  const text = String(alias || '').trim();
  if (!text) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(text)) {
    throw new Error('Invalid --alias. Use only letters, numbers, dot, underscore, dash.');
  }
  return text.slice(0, 64);
}

function formatDurationMs(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return 'disabled';
  if (value % 3600000 === 0) return `${value / 3600000}h`;
  if (value % 60000 === 0) return `${value / 60000}m`;
  if (value % 1000 === 0) return `${value / 1000}s`;
  return `${value}ms`;
}

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

async function stopAndCleanupProfile(profileId, options = {}) {
  const id = String(profileId || '').trim();
  if (!id) return { profileId: id, ok: false, error: 'profile_required' };
  const force = options.force === true;
  const serviceUp = options.serviceUp === true;
  let result = null;
  let error = null;
  if (serviceUp) {
    try {
      result = await callAPI('stop', force ? { profileId: id, force: true } : { profileId: id });
    } catch (err) {
      error = err;
    }
  }
  stopSessionWatchdog(id);
  releaseLock(id);
  markSessionClosed(id);
  return {
    profileId: id,
    ok: !error,
    serviceUp,
    result,
    error: error ? (error.message || String(error)) : null,
  };
}

async function probeViewportSize(profileId) {
  try {
    const payload = await callAPI('evaluate', {
      profileId,
      script: '(() => ({ width: Number(window.innerWidth || 0), height: Number(window.innerHeight || 0) }))()',
    });
    const size = payload?.result || payload?.data || payload || {};
    const width = Number(size?.width || 0);
    const height = Number(size?.height || 0);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
    return { width, height };
  } catch {
    return null;
  }
}

export async function requestDevtoolsOpen(profileId, options = {}) {
  const id = String(profileId || '').trim();
  if (!id) {
    return { ok: false, requested: false, reason: 'profile_required', shortcuts: [] };
  }

  const shortcuts = Array.isArray(options.shortcuts) && options.shortcuts.length
    ? options.shortcuts.map((item) => String(item || '').trim()).filter(Boolean)
    : DEVTOOLS_SHORTCUTS;
  const settleMs = Math.max(0, parseNumber(options.settleMs, 180));
  const before = await probeViewportSize(id);
  const attempts = [];

  for (const key of shortcuts) {
    try {
      await callAPI('keyboard:press', { profileId: id, key });
      attempts.push({ key, ok: true });
      if (settleMs > 0) {
        // Allow browser UI animation to settle after shortcut.
        // eslint-disable-next-line no-await-in-loop
        await sleep(settleMs);
      }
    } catch (err) {
      attempts.push({ key, ok: false, error: err?.message || String(err) });
    }
  }

  const after = await probeViewportSize(id);
  const beforeHeight = Number(before?.height || 0);
  const afterHeight = Number(after?.height || 0);
  const viewportReduced = beforeHeight > 0 && afterHeight > 0 && afterHeight < (beforeHeight - 100);
  const successCount = attempts.filter((item) => item.ok).length;

  return {
    ok: successCount > 0,
    requested: true,
    shortcuts,
    attempts,
    before,
    after,
    verified: viewportReduced,
    verification: viewportReduced ? 'viewport_height_reduced' : 'shortcut_dispatched',
  };
}

export function computeTargetViewportFromWindowMetrics(measured) {
  const innerWidth = Math.max(320, parseNumber(measured?.innerWidth, 0));
  const innerHeight = Math.max(240, parseNumber(measured?.innerHeight, 0));
  const outerWidth = Math.max(320, parseNumber(measured?.outerWidth, innerWidth));
  const outerHeight = Math.max(240, parseNumber(measured?.outerHeight, innerHeight));

  const rawDeltaW = Math.max(0, outerWidth - innerWidth);
  const rawDeltaH = Math.max(0, outerHeight - innerHeight);
  const frameW = rawDeltaW > 400 ? 16 : Math.min(rawDeltaW, 120);
  const frameH = rawDeltaH > 400 ? 88 : Math.min(rawDeltaH, 180);

  return {
    width: Math.max(320, outerWidth - frameW),
    height: Math.max(240, outerHeight - frameH),
    frameW,
    frameH,
    innerWidth,
    innerHeight,
    outerWidth,
    outerHeight,
  };
}

export function computeStartWindowSize(metrics, options = {}) {
  const display = metrics?.metrics || metrics || {};
  const reserveFromEnv = parseNumber(process.env.CAMO_DEFAULT_WINDOW_VERTICAL_RESERVE, START_WINDOW_DEFAULT_RESERVE);
  const reserve = clamp(
    parseNumber(options.reservePx, reserveFromEnv),
    0,
    START_WINDOW_MAX_RESERVE,
  );

  const workWidth = parseNumber(display.workWidth, 0);
  const workHeight = parseNumber(display.workHeight, 0);
  const width = parseNumber(display.width, 0);
  const height = parseNumber(display.height, 0);
  const baseW = Math.floor(workWidth > 0 ? workWidth : width);
  const baseH = Math.floor(workHeight > 0 ? workHeight : height);

  if (baseW <= 0 || baseH <= 0) {
    return {
      width: 1920,
      height: 1000,
      reservePx: reserve,
      source: 'fallback',
    };
  }

  return {
    width: Math.max(START_WINDOW_MIN_WIDTH, baseW),
    height: Math.max(START_WINDOW_MIN_HEIGHT, baseH - reserve),
    reservePx: reserve,
    source: workWidth > 0 || workHeight > 0 ? 'workArea' : 'screen',
  };
}

async function probeWindowMetrics(profileId) {
  const measured = await callAPI('evaluate', {
    profileId,
    script: '({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight })',
  });
  return measured?.result || {};
}

export async function syncWindowViewportAfterResize(profileId, width, height, options = {}) {
  const settleMs = Math.max(40, parseNumber(options.settleMs, 120));
  const attempts = Math.max(1, Math.min(8, Math.floor(parseNumber(options.attempts, 4))));
  const tolerancePx = Math.max(0, parseNumber(options.tolerancePx, 3));

  const windowResult = await callAPI('window:resize', { profileId, width, height });
  await sleep(settleMs);

  let measured = {};
  let verified = {};
  let viewport = null;
  let matched = false;
  let target = { width: 1280, height: 720, frameW: 16, frameH: 88 };

  for (let i = 0; i < attempts; i += 1) {
    measured = await probeWindowMetrics(profileId);
    target = computeTargetViewportFromWindowMetrics(measured);
    viewport = await callAPI('page:setViewport', {
      profileId,
      width: target.width,
      height: target.height,
    });
    await sleep(settleMs);
    verified = await probeWindowMetrics(profileId);
    const dw = Math.abs(parseNumber(verified?.innerWidth, 0) - target.width);
    const dh = Math.abs(parseNumber(verified?.innerHeight, 0) - target.height);
    if (dw <= tolerancePx && dh <= tolerancePx) {
      matched = true;
      break;
    }
  }

  return {
    window: windowResult,
    measured,
    verified,
    targetViewport: {
      width: target.width,
      height: target.height,
      frameW: target.frameW,
      frameH: target.frameH,
      matched,
    },
    viewport,
  };
}

export async function handleStartCommand(args) {
  ensureCamoufox();
  await ensureBrowserService();
  cleanupStaleLocks();
  cleanupStaleSessions();

  const urlIdx = args.indexOf('--url');
  const explicitUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const widthIdx = args.indexOf('--width');
  const heightIdx = args.indexOf('--height');
  const explicitWidth = widthIdx >= 0 ? parseNumber(args[widthIdx + 1], NaN) : NaN;
  const explicitHeight = heightIdx >= 0 ? parseNumber(args[heightIdx + 1], NaN) : NaN;
  const hasExplicitWidth = Number.isFinite(explicitWidth);
  const hasExplicitHeight = Number.isFinite(explicitHeight);
  const alias = validateAlias(readFlagValue(args, ['--alias']));
  const idleTimeoutRaw = readFlagValue(args, ['--idle-timeout']);
  const parsedIdleTimeoutMs = parseDurationMs(idleTimeoutRaw, DEFAULT_HEADLESS_IDLE_TIMEOUT_MS);
  const wantsDevtools = args.includes('--devtools');
  if (hasExplicitWidth !== hasExplicitHeight) {
    throw new Error('Usage: camo start [profileId] [--url <url>] [--headless] [--devtools] [--alias <name>] [--idle-timeout <duration>] [--width <w> --height <h>]');
  }
  if ((hasExplicitWidth && explicitWidth < START_WINDOW_MIN_WIDTH) || (hasExplicitHeight && explicitHeight < START_WINDOW_MIN_HEIGHT)) {
    throw new Error(`Window size too small. Minimum is ${START_WINDOW_MIN_WIDTH}x${START_WINDOW_MIN_HEIGHT}`);
  }
  const hasExplicitWindowSize = hasExplicitWidth && hasExplicitHeight;
  const profileSet = new Set(listProfiles());
  let implicitUrl;
  
  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url') { i++; continue; }
    if (arg === '--width' || arg === '--height') { i++; continue; }
    if (arg === '--alias' || arg === '--idle-timeout') { i++; continue; }
    if (arg === '--headless') continue;
    if (arg.startsWith('--')) continue;

    if (looksLikeUrlToken(arg) && !profileSet.has(arg)) {
      implicitUrl = arg;
      continue;
    }

    profileId = arg;
    break;
  }
  
  if (!profileId) {
    profileId = getDefaultProfile();
    if (!profileId) {
      throw new Error('No default profile set. Run: camo profile default <profileId>');
    }
  }
  if (alias && isSessionAliasTaken(alias, profileId)) {
    throw new Error(`Alias is already in use: ${alias}`);
  }

  // Check for existing session in browser service
  const existing = await getSessionByProfile(profileId);
  if (existing) {
    // Session exists in browser service - update registry and lock
    acquireLock(profileId, { sessionId: existing.session_id || existing.profileId });
    const saved = getSessionInfo(profileId);
    const record = saved
      ? updateSession(profileId, {
        sessionId: existing.session_id || existing.profileId,
        url: existing.current_url,
        mode: existing.mode,
        alias: alias || saved.alias || null,
      })
      : registerSession(profileId, {
        sessionId: existing.session_id || existing.profileId,
        url: existing.current_url,
        mode: existing.mode,
        alias: alias || null,
      });
    const idleState = computeIdleState(record);
    const payload = {
      ok: true,
      sessionId: existing.session_id || existing.profileId,
      instanceId: record.instanceId,
      profileId,
      message: 'Session already running',
      url: existing.current_url,
      alias: record.alias || null,
      idleTimeoutMs: idleState.timeoutMs,
      idleTimeout: formatDurationMs(idleState.timeoutMs),
      closeHint: {
        byProfile: `camo stop ${profileId}`,
        byId: `camo stop --id ${record.instanceId}`,
        byAlias: record.alias ? `camo stop --alias ${record.alias}` : null,
      },
    };
    const existingMode = String(existing?.mode || record?.mode || '').toLowerCase();
    const existingHeadless = existing?.headless === true || existingMode.includes('headless');
    if (!existingHeadless && wantsDevtools) {
      payload.devtools = await requestDevtoolsOpen(profileId);
    }
    console.log(JSON.stringify(payload, null, 2));
    startSessionWatchdog(profileId);
    return;
  }

  // No session in browser service - check registry for recovery
  const registryInfo = getSessionInfo(profileId);
  if (registryInfo && registryInfo.status === 'active') {
    // Session was active but browser service doesn't have it
    // This means service was restarted - clean up and start fresh
    unregisterSession(profileId);
    releaseLock(profileId);
  }

  const headless = args.includes('--headless');
  if (wantsDevtools && headless) {
    throw new Error('--devtools is not supported with --headless');
  }
  const idleTimeoutMs = headless ? parsedIdleTimeoutMs : 0;
  const targetUrl = explicitUrl || implicitUrl;
  const result = await callAPI('start', {
    profileId,
    url: targetUrl ? ensureUrlScheme(targetUrl) : undefined,
    headless,
    devtools: wantsDevtools,
  });
  
  if (result?.ok) {
    const sessionId = result.sessionId || result.profileId || profileId;
    acquireLock(profileId, { sessionId });
    const record = registerSession(profileId, {
      sessionId,
      url: targetUrl,
      headless,
      alias,
      idleTimeoutMs,
      lastAction: 'start',
    });
    startSessionWatchdog(profileId);
    result.instanceId = record.instanceId;
    result.alias = record.alias || null;
    result.idleTimeoutMs = idleTimeoutMs;
    result.idleTimeout = formatDurationMs(idleTimeoutMs);
    result.closeHint = {
      byProfile: `camo stop ${profileId}`,
      byId: `camo stop --id ${record.instanceId}`,
      byAlias: record.alias ? `camo stop --alias ${record.alias}` : null,
      all: 'camo close all',
    };
    result.message = headless
      ? `Started headless session. Idle timeout: ${formatDurationMs(idleTimeoutMs)}`
      : 'Started session. Remember to stop it when finished.';

    if (!headless) {
      let windowTarget = null;
      if (hasExplicitWindowSize) {
        windowTarget = {
          width: Math.floor(explicitWidth),
          height: Math.floor(explicitHeight),
          source: 'explicit',
        };
      } else {
        const rememberedWindow = getProfileWindowSize(profileId);
        if (rememberedWindow) {
          windowTarget = {
            width: rememberedWindow.width,
            height: rememberedWindow.height,
            source: 'profile',
            updatedAt: rememberedWindow.updatedAt,
          };
        } else {
          const display = await callAPI('system:display', {}).catch(() => null);
          windowTarget = computeStartWindowSize(display);
        }
      }

      result.startWindow = {
        width: windowTarget.width,
        height: windowTarget.height,
        source: windowTarget.source,
      };

      const syncResult = await syncWindowViewportAfterResize(
        profileId,
        windowTarget.width,
        windowTarget.height,
      ).catch((err) => ({ error: err?.message || String(err) }));
      result.windowSync = syncResult;

      const measuredOuterWidth = Number(syncResult?.verified?.outerWidth);
      const measuredOuterHeight = Number(syncResult?.verified?.outerHeight);
      const savedWindow = setProfileWindowSize(
        profileId,
        Number.isFinite(measuredOuterWidth) ? measuredOuterWidth : windowTarget.width,
        Number.isFinite(measuredOuterHeight) ? measuredOuterHeight : windowTarget.height,
      );
      result.profileWindow = savedWindow?.window || null;
      if (wantsDevtools) {
        result.devtools = await requestDevtoolsOpen(profileId);
      }
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

export async function handleStopCommand(args) {
  const rawTarget = String(args[1] || '').trim();
  const target = rawTarget.toLowerCase();
  const idTarget = readFlagValue(args, ['--id']);
  const aliasTarget = readFlagValue(args, ['--alias']);
  if (args.includes('--id') && !idTarget) {
    throw new Error('Usage: camo stop --id <instanceId>');
  }
  if (args.includes('--alias') && !aliasTarget) {
    throw new Error('Usage: camo stop --alias <alias>');
  }
  const stopIdle = target === 'idle' || args.includes('--idle');
  const stopAll = target === 'all';
  const serviceUp = await checkBrowserService();

  if (stopAll) {
    let liveSessions = [];
    if (serviceUp) {
      try {
        const status = await callAPI('getStatus', {});
        liveSessions = Array.isArray(status?.sessions) ? status.sessions : [];
      } catch {
        // Ignore and fallback to local registry.
      }
    }
    const profileSet = new Set(liveSessions.map((item) => String(item?.profileId || '').trim()).filter(Boolean));
    for (const session of listRegisteredSessions()) {
      if (String(session?.status || '').trim() === 'closed') continue;
      const profileId = String(session?.profileId || '').trim();
      if (profileId) profileSet.add(profileId);
    }

    const results = [];
    for (const profileId of profileSet) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await stopAndCleanupProfile(profileId, { serviceUp }));
    }
    console.log(JSON.stringify({
      ok: true,
      mode: 'all',
      serviceUp,
      closed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    }, null, 2));
    return;
  }

  if (stopIdle) {
    const now = Date.now();
    const registeredSessions = listRegisteredSessions();
    let liveSessions = [];
    if (serviceUp) {
      try {
        const status = await callAPI('getStatus', {});
        liveSessions = Array.isArray(status?.sessions) ? status.sessions : [];
      } catch {
        // Ignore and fallback to local registry.
      }
    }
    const regMap = new Map(
      registeredSessions
        .filter((item) => item && String(item?.status || '').trim() === 'active')
        .map((item) => [String(item.profileId || '').trim(), item]),
    );
    const idleTargets = new Set(
      registeredSessions
      .filter((item) => String(item?.status || '').trim() === 'active')
      .map((item) => ({ session: item, idle: computeIdleState(item, now) }))
      .filter((item) => item.idle.idle)
      .map((item) => item.session.profileId),
    );
    let orphanLiveHeadlessCount = 0;
    for (const live of liveSessions) {
      const liveProfileId = String(live?.profileId || '').trim();
      if (!liveProfileId) continue;
      if (regMap.has(liveProfileId) || idleTargets.has(liveProfileId)) continue;
      const mode = String(live?.mode || '').toLowerCase();
      const liveHeadless = live?.headless === true || mode.includes('headless');
      // Live but unregistered headless sessions are treated as idle-orphan targets.
      if (liveHeadless) {
        idleTargets.add(liveProfileId);
        orphanLiveHeadlessCount += 1;
      }
    }
    const results = [];
    for (const profileId of idleTargets) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await stopAndCleanupProfile(profileId, { serviceUp }));
    }
    console.log(JSON.stringify({
      ok: true,
      mode: 'idle',
      serviceUp,
      targetCount: idleTargets.size,
      orphanLiveHeadlessCount,
      closed: results.filter((item) => item.ok).length,
      failed: results.filter((item) => !item.ok).length,
      results,
    }, null, 2));
    return;
  }

  let profileId = null;
  let resolvedBy = 'profile';
  if (idTarget) {
    const resolved = resolveSessionTarget(idTarget);
    if (!resolved) throw new Error(`No session found for instance id: ${idTarget}`);
    profileId = resolved.profileId;
    resolvedBy = resolved.reason;
  } else if (aliasTarget) {
    const resolved = resolveSessionTarget(aliasTarget);
    if (!resolved) throw new Error(`No session found for alias: ${aliasTarget}`);
    profileId = resolved.profileId;
    resolvedBy = resolved.reason;
  } else {
    const positional = args.slice(1).find((arg) => arg && !String(arg).startsWith('--')) || null;
    if (positional) {
      const resolved = resolveSessionTarget(positional);
      if (resolved) {
        profileId = resolved.profileId;
        resolvedBy = resolved.reason;
      } else {
        profileId = positional;
      }
    }
  }

  if (!profileId) {
    profileId = getDefaultProfile();
  }
  if (!profileId) {
    throw new Error('Usage: camo stop [profileId] | camo stop --id <instanceId> | camo stop --alias <alias> | camo stop all | camo stop idle');
  }

  const result = await stopAndCleanupProfile(profileId, { serviceUp });
  if (!result.ok && serviceUp) {
    throw new Error(result.error || `stop failed for profile: ${profileId}`);
  }
  console.log(JSON.stringify({
    ok: true,
    profileId,
    resolvedBy,
    serviceUp,
    warning: (!serviceUp && !result.ok) ? result.error : null,
    result: result.result || null,
  }, null, 2));
}

export async function handleStatusCommand(args) {
  await ensureBrowserService();
  const result = await callAPI('getStatus', {});
  const profileId = args[1];
  if (profileId && args[0] === 'status') {
    const session = result?.sessions?.find((s) => s.profileId === profileId) || null;
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

export async function handleGotoCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);

  let profileId;
  let url;

  if (positionals.length === 1) {
    profileId = getDefaultProfile();
    url = positionals[0];
  } else {
    profileId = resolveProfileId(positionals, 0, getDefaultProfile);
    url = positionals[1];
  }

  if (!profileId) throw new Error('Usage: camo goto [profileId] <url> (or set default profile first)');
  if (!url) throw new Error('Usage: camo goto [profileId] <url>');
  
  const result = await callAPI('goto', { profileId, url: ensureUrlScheme(url) });
  updateSession(profileId, { url: ensureUrlScheme(url), lastSeen: Date.now() });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleBackCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo back [profileId] (or set default profile first)');
  const result = await callAPI('page:back', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleScreenshotCommand(args) {
  await ensureBrowserService();
  const fullPage = args.includes('--full');
  const outputIdx = args.indexOf('--output');
  const output = outputIdx >= 0 ? args[outputIdx + 1] : null;
  
  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full') continue;
    if (arg === '--output') { i++; continue; }
    if (arg.startsWith('--')) continue;
    profileId = arg;
    break;
  }
  
  if (!profileId) profileId = getDefaultProfile();
  if (!profileId) throw new Error('Usage: camo screenshot [profileId] [--output <file>] [--full]');
  
  const result = await callAPI('screenshot', { profileId, fullPage });

  if (output && result?.data) {
    fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
    console.log(`Screenshot saved to ${output}`);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

export async function handleScrollCommand(args) {
  await ensureBrowserService();
  const directionFlags = new Set(['--up', '--down', '--left', '--right']);
  const isFlag = (arg) => arg?.startsWith('--');

  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (directionFlags.has(arg)) continue;
    if (arg === '--amount') { i++; continue; }
    if (isFlag(arg)) continue;
    profileId = arg;
    break;
  }
  if (!profileId) profileId = getDefaultProfile();
  if (!profileId) throw new Error('Usage: camo scroll [profileId] [--down|--up|--left|--right] [--amount <px>]');

  const direction = args.includes('--up') ? 'up' : args.includes('--left') ? 'left' : args.includes('--right') ? 'right' : 'down';
  const amountIdx = args.indexOf('--amount');
  const amount = amountIdx >= 0 ? Number(args[amountIdx + 1]) || 300 : 300;

  const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
  const result = await callAPI('mouse:wheel', { profileId, deltaX, deltaY });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleClickCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);
  let profileId;
  let selector;

  if (positionals.length === 1) {
    profileId = getDefaultProfile();
    selector = positionals[0];
  } else {
    profileId = positionals[0];
    selector = positionals[1];
  }

  if (!profileId) throw new Error('Usage: camo click [profileId] <selector>');
  if (!selector) throw new Error('Usage: camo click [profileId] <selector>');

  const result = await callAPI('evaluate', {
    profileId,
    script: buildSelectorClickScript({ selector, highlight: false }),
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleTypeCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);
  let profileId;
  let selector;
  let text;

  if (positionals.length === 2) {
    profileId = getDefaultProfile();
    selector = positionals[0];
    text = positionals[1];
  } else {
    profileId = positionals[0];
    selector = positionals[1];
    text = positionals[2];
  }

  if (!profileId) throw new Error('Usage: camo type [profileId] <selector> <text>');
  if (!selector || text === undefined) throw new Error('Usage: camo type [profileId] <selector> <text>');

  const result = await callAPI('evaluate', {
    profileId,
    script: buildSelectorTypeScript({ selector, highlight: false, text }),
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleHighlightCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);
  let profileId;
  let selector;

  if (positionals.length === 1) {
    profileId = getDefaultProfile();
    selector = positionals[0];
  } else {
    profileId = positionals[0];
    selector = positionals[1];
  }

  if (!profileId) throw new Error('Usage: camo highlight [profileId] <selector>');
  if (!selector) throw new Error('Usage: camo highlight [profileId] <selector>');

  const result = await callAPI('evaluate', {
    profileId,
    script: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      const prev = el.style.outline;
      el.style.outline = '3px solid #ff4444';
      setTimeout(() => { el.style.outline = prev; }, 2000);
      const rect = el.getBoundingClientRect();
      return { highlighted: true, selector: ${JSON.stringify(selector)}, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    })()`
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleClearHighlightCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo clear-highlight [profileId]');

  const result = await callAPI('evaluate', {
    profileId,
    script: `(() => {
      const overlay = document.getElementById('webauto-highlight-overlay');
      if (overlay) overlay.remove();
      document.querySelectorAll('[data-webauto-highlight]').forEach(el => {
        el.style.outline = el.dataset.webautoHighlight || '';
        delete el.dataset.webautoHighlight;
      });
      return { cleared: true };
    })()`
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleViewportCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo viewport [profileId] --width <w> --height <h>');

  const widthIdx = args.indexOf('--width');
  const heightIdx = args.indexOf('--height');
  const width = widthIdx >= 0 ? Number(args[widthIdx + 1]) : 1280;
  const height = heightIdx >= 0 ? Number(args[heightIdx + 1]) : 800;

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Usage: camo viewport [profileId] --width <w> --height <h>');
  }

  const result = await callAPI('page:setViewport', { profileId, width, height });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleNewPageCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo new-page [profileId] [--url <url>] (or set default profile first)');
  const urlIdx = args.indexOf('--url');
  const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const result = await callAPI('newPage', { profileId, ...(url ? { url: ensureUrlScheme(url) } : {}) });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleClosePageCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo close-page [profileId] [index] (or set default profile first)');
  
  let index;
  for (let i = args.length - 1; i >= 1; i--) {
    const arg = args[i];
    if (arg.startsWith('--')) continue;
    const num = Number(arg);
    if (Number.isFinite(num)) { index = num; break; }
  }
  
  const result = await callAPI('page:close', { profileId, ...(Number.isFinite(index) ? { index } : {}) });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleSwitchPageCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo switch-page [profileId] <index> (or set default profile first)');
  
  let index;
  for (let i = args.length - 1; i >= 1; i--) {
    const arg = args[i];
    if (arg.startsWith('--')) continue;
    const num = Number(arg);
    if (Number.isFinite(num)) { index = num; break; }
  }
  
  if (!Number.isFinite(index)) throw new Error('Usage: camo switch-page [profileId] <index>');
  const result = await callAPI('page:switch', { profileId, index });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleListPagesCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo list-pages [profileId] (or set default profile first)');
  const result = await callAPI('page:list', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleShutdownCommand() {
  await ensureBrowserService();
  
  // Get all active sessions
  const status = await callAPI('getStatus', {});
  const sessions = Array.isArray(status?.sessions) ? status.sessions : [];
  
  // Stop each session and cleanup registry
  for (const session of sessions) {
    try {
      await callAPI('stop', { profileId: session.profileId });
    } catch {
      // Best effort cleanup
    }
    stopSessionWatchdog(session.profileId);
    releaseLock(session.profileId);
    markSessionClosed(session.profileId);
  }
  
  // Cleanup any remaining registry entries
  const registered = listRegisteredSessions();
  for (const reg of registered) {
    if (reg.status !== 'closed') {
      stopSessionWatchdog(reg.profileId);
      markSessionClosed(reg.profileId);
      releaseLock(reg.profileId);
    }
  }
  stopAllSessionWatchdogs();
  
  const result = await callAPI('service:shutdown', {});
  console.log(JSON.stringify(result, null, 2));
}

export async function handleSessionsCommand(args) {
  const serviceUp = await checkBrowserService();
  const registeredSessions = listRegisteredSessions();
  
  let liveSessions = [];
  if (serviceUp) {
    try {
      const status = await callAPI('getStatus', {});
      liveSessions = Array.isArray(status?.sessions) ? status.sessions : [];
    } catch {
      // Service may have just become unavailable
    }
  }
  
  // Merge live and registered sessions
  const liveProfileIds = new Set(liveSessions.map(s => s.profileId));
  const merged = [...liveSessions];
  
  // Add registered sessions that are not in live sessions (need recovery)
  for (const reg of registeredSessions) {
    if (!liveProfileIds.has(reg.profileId) && reg.status === 'active') {
      merged.push({
        ...reg,
        live: false,
        needsRecovery: true,
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
  }, null, 2));
}
