import fs from 'node:fs';
import {
  listProfiles,
  getDefaultProfile,
  getProfileWindowSize,
  setProfileWindowSize,
} from '../utils/config.mjs';
import { callAPI, ensureCamoufox, ensureBrowserService, getSessionByProfile, checkBrowserService } from '../utils/browser-service.mjs';
import { resolveProfileId, ensureUrlScheme, looksLikeUrlToken, getPositionals } from '../utils/args.mjs';
import { acquireLock, releaseLock, isLocked, getLockInfo, cleanupStaleLocks } from '../lifecycle/lock.mjs';
import { registerSession, updateSession, getSessionInfo, unregisterSession, listRegisteredSessions, markSessionClosed, cleanupStaleSessions, recoverSession } from '../lifecycle/session-registry.mjs';
import { startSessionWatchdog, stopAllSessionWatchdogs, stopSessionWatchdog } from '../lifecycle/session-watchdog.mjs';

const START_WINDOW_MIN_WIDTH = 960;
const START_WINDOW_MIN_HEIGHT = 700;
const START_WINDOW_MAX_RESERVE = 240;
const START_WINDOW_DEFAULT_RESERVE = 72;

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
  if (hasExplicitWidth !== hasExplicitHeight) {
    throw new Error('Usage: camo start [profileId] [--url <url>] [--headless] [--width <w> --height <h>]');
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

  // Check for existing session in browser service
  const existing = await getSessionByProfile(profileId);
  if (existing) {
    // Session exists in browser service - update registry and lock
    acquireLock(profileId, { sessionId: existing.session_id || existing.profileId });
    registerSession(profileId, {
      sessionId: existing.session_id || existing.profileId,
      url: existing.current_url,
      mode: existing.mode,
    });
    console.log(JSON.stringify({
      ok: true,
      sessionId: existing.session_id || existing.profileId,
      profileId,
      message: 'Session already running',
      url: existing.current_url,
    }, null, 2));
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
  const targetUrl = explicitUrl || implicitUrl;
  const result = await callAPI('start', {
    profileId,
    url: targetUrl ? ensureUrlScheme(targetUrl) : undefined,
    headless,
  });
  
  if (result?.ok) {
    const sessionId = result.sessionId || result.profileId || profileId;
    acquireLock(profileId, { sessionId });
    registerSession(profileId, {
      sessionId,
      url: targetUrl,
      headless,
    });
    startSessionWatchdog(profileId);

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
    }
  }
  console.log(JSON.stringify(result, null, 2));
}

export async function handleStopCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo stop [profileId]');

  let result = null;
  let stopError = null;
  try {
    result = await callAPI('stop', { profileId });
  } catch (err) {
    stopError = err;
  } finally {
    stopSessionWatchdog(profileId);
    releaseLock(profileId);
    markSessionClosed(profileId);
  }

  if (stopError) throw stopError;
  console.log(JSON.stringify(result, null, 2));
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
    script: `(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 200));
      el.click();
      return { clicked: true, selector: ${JSON.stringify(selector)} };
    })()`
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
    script: `(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 200));
      el.focus();
      el.value = '';
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, selector: ${JSON.stringify(selector)}, length: ${text.length} };
    })()`
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
