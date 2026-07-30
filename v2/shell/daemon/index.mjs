// camo v2 daemon entry. Module id=shell.daemon.
//
// Dual-mode lifecycle manager:
//   - EPHEMERAL (default): auto-start browser per command, auto-cleanup after
//   - PERSISTENT (with --profile): browser stays alive until explicit stop
//
// Dynamic port allocation:
//   - WS_PORT=0 (default) lets OS assign a free port
//   - HTTP_PORT=0 (default) lets OS assign a free port
//   - Daemon registers itself at ~/.camo/daemon/<id>.json for CLI discovery
//
// Hard guards:
//   - No zombie browsers: all ephemeral browsers closed after command
//   - No stale runs: ephemeral run data cleaned after completion
//   - Profile lock prevents concurrent daemons on same profile
//   - EADDRINUSE on explicit port exits with code 2 + clear message

import { WebSocketServer } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { CamoError, project as projectError } from '../../contracts/error_envelope/projector.mjs';
import { build, parse } from '../../contracts/ws_messages/v1/envelope.mjs';
import { append as appendProgress } from '../../services/progress_event/log.mjs';
import { 
  startSession, 
  stopSession, 
  getSession,
  __enableTestRoot as enableBrowserServiceTest,
  enableAllOwners as enableAllBrowserOwners
} from '../../services/browser_service/bootstrap.mjs';
import { cleanupStaleRegistrations, unregisterByPid } from '../config/daemon_finder.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// --- Configuration ---
const WS_PORT = parseInt(process.env.CAMO_WS_PORT || '0', 10);
const HTTP_PORT = parseInt(process.env.CAMO_HTTP_PORT || '0', 10);
const DEFAULT_PROFILE = process.env.CAMO_PROFILE || '_ephemeral_';

// --- Daemon registration ---
const DAEMON_DIR = path.join(os.homedir(), '.camo', 'daemon');
const LOCK_DIR = path.join(os.homedir(), '.camo', 'locks');

function generateDaemonId() {
  return `daemon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function registerDaemon(wsPort, httpPort, profile, mode) {
  fs.mkdirSync(DAEMON_DIR, { recursive: true });
  const daemonId = generateDaemonId();
  const payload = {
    daemonId,
    pid: process.pid,
    wsPort,
    httpPort,
    profile,
    mode,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
  };
  const file = path.join(DAEMON_DIR, `${daemonId}.json`);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, file);
  return { daemonId, file, payload };
}

function unregisterDaemon(daemonId) {
  if (!daemonId) return;
  const file = path.join(DAEMON_DIR, `${daemonId}.json`);
  try { fs.unlinkSync(file); }
  catch (cause) {
    if (cause.code !== 'ENOENT') {
      throw new CamoError({
        code: 'E_IO_FILESYSTEM',
        details: { op: 'daemon.unregister', path: file, reason: cause?.message || String(cause) },
        cause,
      });
    }
  }
}

function cleanupStaleDaemons(profile) {
  if (!fs.existsSync(DAEMON_DIR)) return;
  for (const entry of fs.readdirSync(DAEMON_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(DAEMON_DIR, entry);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw.pid === process.pid) continue;
      if (profile && raw.profile && raw.profile !== profile && !raw.profile.startsWith('_ephemeral_')) continue;
      try { process.kill(raw.pid, 0); } // alive
      catch {
        try { fs.unlinkSync(file); }
        catch (cause) {
          if (cause.code !== 'ENOENT') {
            throw new CamoError({
              code: 'E_IO_FILESYSTEM',
              details: { op: 'daemon.cleanupStale', path: file, reason: cause?.message || String(cause) },
              cause,
            });
          }
        }
      }
    } catch {}
  }
}

function checkProfileConflict(profile) {
  if (!profile || profile.startsWith('_ephemeral_')) return null;
  if (!fs.existsSync(DAEMON_DIR)) return null;
  for (const entry of fs.readdirSync(DAEMON_DIR)) {
    if (!entry.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DAEMON_DIR, entry), 'utf8'));
      if (raw.profile === profile && raw.pid !== process.pid) {
        try {
          process.kill(raw.pid, 0);
          return { pid: raw.pid, daemonId: raw.daemonId, wsPort: raw.wsPort };
        } catch {
          // stale
        }
      }
    } catch {}
  }
  return null;
}

let opts = {
  profile: DEFAULT_PROFILE,
  mode: 'persistent',
  daemonId: null,
  daemonRegistration: null,
};

function parseArgs(argv) {
  const o = { profile: DEFAULT_PROFILE, mode: 'persistent' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--profile' && argv[i + 1]) {
      o.profile = String(argv[++i]).trim();
      o.mode = 'persistent';
    }
    if (argv[i] === '--ephemeral') {
      o.profile = `_ephemeral_${process.pid}_${Date.now()}`;
      o.mode = 'ephemeral';
    }
    if (argv[i] === '--headless') o.mode = 'headless';
  }
  return o;
}

// --- Parse args early ---
opts = parseArgs(process.argv);

// Check for same-profile conflict before starting
const conflict = checkProfileConflict(opts.profile);
if (conflict) {
  console.error(`[camo daemon] Fatal: profile "${opts.profile}" already owned by daemon pid=${conflict.pid} wsPort=${conflict.wsPort}`);
  console.error(`[camo daemon] Use --force or stop the existing daemon first.`);
  process.exit(2);
}

// Clean stale daemon registrations for this profile
cleanupStaleDaemons(opts.profile);

// Enable browser_service for this daemon process
enableBrowserServiceTest();
// Ensure all downstream writable scopes are enabled before serving.
await enableAllBrowserOwners();

// Generate ephemeral runId
const RUN_ID = opts.mode === 'ephemeral' 
  ? `ephemeral-${process.pid}-${Date.now()}`
  : `run-${process.pid}-${Date.now()}`;

function emit(type, payload) {
  appendProgress({ 
    runId: RUN_ID, 
    event: type, 
    source: 'daemon', 
    payload, 
    ts: new Date().toISOString() 
  });
}

// --- Browser lifecycle management ---
let currentBrowserProfile = null;
let browserRefCount = 0;

async function ensureBrowser(profile, forcePersistent) {
  const targetProfile = profile || opts.profile;
  
  if (opts.mode === 'ephemeral' || forcePersistent) {
    if (currentBrowserProfile !== targetProfile || browserRefCount === 0) {
      if (currentBrowserProfile && currentBrowserProfile !== targetProfile) {
        try { await stopSession(currentBrowserProfile); } catch {}
      }
      await startSession({ profileId: targetProfile, headless: opts.mode === 'headless' });
      currentBrowserProfile = targetProfile;
    }
    browserRefCount++;
    return targetProfile;
  }
  
  if (!currentBrowserProfile) {
    await startSession({ profileId: targetProfile, headless: opts.mode === 'headless' });
    currentBrowserProfile = targetProfile;
    browserRefCount = 1;
  } else {
    browserRefCount++;
  }
  return currentBrowserProfile;
}

async function releaseBrowser(forceClose) {
  if (opts.mode === 'ephemeral' || forceClose) {
    if (currentBrowserProfile) {
      try { await stopSession(currentBrowserProfile); } catch {}
      currentBrowserProfile = null;
      browserRefCount = 0;
    }
  } else {
    browserRefCount = Math.max(0, browserRefCount - 1);
  }
}

// --- Command handlers ---
async function handleCommand(env) {
  const { cmd, args = {} } = env.payload || {};
  const profile = args.profile || opts.profile;
  const isEphemeral = profile.startsWith('_ephemeral_') || opts.mode === 'ephemeral';
  const startedAt = Date.now();

  emit('command.start', { cmd, args, profile, ephemeral: isEphemeral });

  try {
    let result;
    let closeAfter = false;

    const browserCmds = ['goto', 'click', 'type', 'scroll', 'screenshot', 'snapshot', 'wait', 'evaluate', 'upload', 'select'];
    
    if (browserCmds.includes(cmd)) {
      await ensureBrowser(profile, false);
      closeAfter = isEphemeral;
    }

    switch (cmd) {
      case 'start': {
        const session = await startSession({ 
          profileId: profile, 
          headless: opts.mode === 'headless' 
        });
        result = { ok: true, sessionId: session.sessionId, profile: session.profileId };
        currentBrowserProfile = profile;
        browserRefCount = 1;
        break;
      }
      
      case 'stop': {
        await stopSession(profile);
        result = { ok: true, stopped: true, profile };
        if (currentBrowserProfile === profile) {
          currentBrowserProfile = null;
          browserRefCount = 0;
        }
        break;
      }
      
      case 'goto': {
        const { goto } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await goto({ profileId: profile, url: args.url, waitUntil: args.waitUntil || 'load' });
        result = { ok: true, navigated: true, url: args.url, finalUrl: r.finalUrl, statusCode: r.statusCode };
        break;
      }
      
      case 'click': {
        const { click } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await click({ profileId: profile, selector: args.selector, text: args.text, button: args.button || 'left' });
        result = { ok: true, clicked: true };
        break;
      }
      
      case 'type': {
        const { type } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await type({ profileId: profile, text: args.text, delay: args.delay });
        result = { ok: true, typed: true, length: r.length };
        break;
      }
      
      case 'scroll': {
        const { scroll } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await scroll({ profileId: profile, x: args.x || 0, y: args.y || 0 });
        result = { ok: true, scrolled: true };
        break;
      }
      
      case 'screenshot': {
        const { screenshot } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await screenshot({ profileId: profile, fullPage: args.fullPage === true });
        result = { ok: true, screenshot: true, format: r.format, size: r.size };
        break;
      }
      
      case 'snapshot': {
        const { snapshot } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await snapshot({ profileId: profile });
        result = { ok: true, snapshot: true, url: r.url, htmlLength: r.htmlLength };
        break;
      }
      
      case 'wait': {
        const { wait } = await import('../../services/page_runtime/input_pipeline.mjs');
        await wait({ profileId: profile, ms: args.ms || 1000 });
        result = { ok: true, waited: true, ms: args.ms || 1000 };
        break;
      }
      
      case 'evaluate': {
        const { evaluate } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await evaluate({ profileId: profile, script: args.script });
        result = { ok: true, evaluated: true, result: r.result };
        break;
      }
      
      case 'upload': {
        const { upload } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await upload({ profileId: profile, selector: args.selector, files: args.files });
        result = { ok: true, uploaded: true, fileCount: r.fileCount };
        break;
      }
      
      case 'select': {
        const { select } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await select({ profileId: profile, selector: args.selector, value: args.value });
        result = { ok: true, selected: true };
        break;
      }

      case 'close-tab': {
        const { closeTab } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await closeTab({ profileId: profile, tabId: args.tabId });
        result = { ok: true, closedTab: true };
        break;
      }
      
      case 'daemon': {
        result = { ok: true, daemonId: opts.daemonId, mode: opts.mode, profile: opts.profile };
        break;
      }
      
      case 'fetch-page': {
        const { fetch } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await fetch({ profileId: profile, url: args.url, timeout: args.timeout });
        result = { ok: true, fetched: true, statusCode: r.statusCode, headers: r.headers, body: r.body };
        break;
      }
      
      case 'find-elements': {
        const { findElements } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await findElements({ profileId: profile, selector: args.selector, text: args.text });
        result = { ok: true, found: true, count: r.count, elements: r.elements };
        break;
      }
      
      case 'get-cookies': {
        const { getCookies } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await getCookies({ profileId: profile });
        result = { ok: true, cookies: r.cookies };
        break;
      }
      
      case 'get-page-info': {
        const { getPageInfo } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await getPageInfo({ profileId: profile });
        result = { ok: true, url: r.url, title: r.title, viewport: r.viewport };
        break;
      }
      
      case 'get-readable': {
        const { getReadable } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await getReadable({ profileId: profile, maxLength: args.maxLength });
        result = { ok: true, content: r.content, textLength: r.textLength };
        break;
      }
      
      case 'get-text': {
        const { getText } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await getText({ profileId: profile, selector: args.selector });
        result = { ok: true, text: r.text };
        break;
      }
      
      case 'hover': {
        const { hover } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await hover({ profileId: profile, selector: args.selector, text: args.text });
        result = { ok: true, hovered: true };
        break;
      }
      
      case 'list-tabs': {
        const { listTabs } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await listTabs({ profileId: profile });
        result = { ok: true, tabs: r.tabs };
        break;
      }
      
      case 'new-tab': {
        const { newTab } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await newTab({ profileId: profile, url: args.url });
        result = { ok: true, newTab: true, tabId: r.tabId };
        break;
      }
      
      case 'scroll-and-collect': {
        const { scrollAndCollect } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await scrollAndCollect({ profileId: profile, scrollCount: args.scrollCount, scrollDelay: args.scrollDelay });
        result = { ok: true, scrolled: true, collected: r.collected };
        break;
      }
      
      case 'set-cookies': {
        const { setCookies } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await setCookies({ profileId: profile, cookies: args.cookies });
        result = { ok: true, cookiesSet: true, count: r.count };
        break;
      }
      
      case 'set-user-agent': {
        const { setUserAgent } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await setUserAgent({ profileId: profile, userAgent: args.userAgent });
        result = { ok: true, userAgentSet: true };
        break;
      }
      
      case 'set-viewport': {
        const { setViewport } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await setViewport({ profileId: profile, width: args.width, height: args.height });
        result = { ok: true, viewportSet: true };
        break;
      }
      
      case 'wait-dom-stable': {
        const { waitForDomStable } = await import('../../services/page_runtime/input_pipeline.mjs');
        const r = await waitForDomStable({ profileId: profile, timeout: args.timeout, pollInterval: args.pollInterval });
        result = { ok: true, stable: true, durationMs: r.durationMs };
        break;
      }

      
      default:
        throw new CamoError({ 
          code: 'E_PROTO_NO_HANDLER', 
          details: { cmd, known: ['start','stop','goto','click','type','scroll','screenshot','snapshot','wait','evaluate','upload','select'] 
        }});
    }

    if (closeAfter) {
      await releaseBrowser(true);
    }

    emit('command.done', { cmd, profile, durationMs: Date.now() - startedAt });
    return { kind: 'result', payload: { cmd, ...result } };
    
  } catch (cause) {
    if (profile.startsWith('_ephemeral_') || opts.mode === 'ephemeral') {
      try { await releaseBrowser(true); }
      catch (cleanupErr) { emit('ephemeral.cleanup_failed', { error: String(cleanupErr?.message || cleanupErr) }); }
    }
    
    const proj = cause instanceof CamoError ? cause : new CamoError({ 
      code: 'E_INTERNAL_UNEXPECTED', 
      message: cause?.message || String(cause), 
      cause 
    });
    const projected = projectError(proj);
    emit('command.error', { cmd, profile, error: projected });
    return { kind: 'error', payload: projected };
  }
}

// --- HTTP server ---
function createHttpServer() {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://localhost:${HTTP_PORT}`);
    const method = req.method;

    if (parsedUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ok: true, 
        daemon: opts.daemonId || RUN_ID, 
        profile: currentBrowserProfile || 'idle',
        mode: opts.mode,
        browserCount: browserRefCount,
        ts: new Date().toISOString() 
      }));
      return;
    }

    if (parsedUrl.pathname === '/shutdown' && method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      // Defer shutdown to avoid hanging the response
      setImmediate(() => shutdown(0));
      return;
    }

    if (parsedUrl.pathname === '/status' && method === 'GET') {
      const session = await getSession(opts.profile);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        ok: true, 
        profile: opts.profile,
        mode: opts.mode,
        browserActive: !!currentBrowserProfile,
        session: session || null 
      }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return server;
}

// --- WS server ---
function createWsServer() {
  const wss = new WebSocketServer({ port: WS_PORT });

  wss.on('connection', (ws) => {
    emit('ws.connected', { remoteAddress: ws.socket?.remoteAddress });

    ws.on('message', async (data) => {
      let env;
      try {
        env = parse(String(data));
      } catch {
        ws.send(JSON.stringify(build({ 
          id: 'unknown', 
          kind: 'error', 
          payload: projectError(new CamoError({ code: 'E_PROTO_BAD_ENVELOPE' })) 
        })));
        return;
      }

      if (env.kind === 'ping') {
        ws.send(JSON.stringify(build({ id: env.id, kind: 'pong', payload: { ts: Date.now() } })));
        return;
      }

      if (env.kind === 'command') {
        const out = await handleCommand(env);
        ws.send(JSON.stringify(build({ id: env.id, kind: out.kind, payload: out.payload })));
        return;
      }

      ws.send(JSON.stringify(build({ 
        id: env.id, 
        kind: 'error', 
        payload: projectError(new CamoError({ code: 'E_PROTO_NO_HANDLER', details: { kind: env.kind } })) 
      })));
    });

    ws.on('close', () => emit('ws.disconnected', {}));
    ws.on('error', (e) => emit('ws.error', { error: e.message }));
  });

  return wss;
}

// --- Lifecycle ---
let wsServer = null;
let httpServer = null;
let shuttingDown = false;

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  
  emit('daemon.shutdown', { code });
  
  // Close all browsers
  if (currentBrowserProfile) {
    await stopSession(currentBrowserProfile); // surface to shutdown caller
  }
  
  // Unregister daemon
  unregisterDaemon(opts.daemonId);
  
  // Close servers
  if (httpServer) httpServer.close();
  if (wsServer) wsServer.close();
  
  await new Promise(r => setTimeout(r, 100));
  process.exit(code);
}

// --- Main ---
async function main(argv) {
  opts = parseArgs(argv);
  
  // Check for same-profile conflict
  const conflict = checkProfileConflict(opts.profile);
  if (conflict) {
    console.error(`[camo daemon] Fatal: profile "${opts.profile}" already owned by daemon pid=${conflict.pid} wsPort=${conflict.wsPort}`);
    console.error(`[camo daemon] Use --force or stop the existing daemon first.`);
    process.exit(2);
  }
  
  // Clean stale daemons
  cleanupStaleDaemons(opts.profile);
  
  enableBrowserServiceTest();
  await enableAllBrowserOwners();
  
  emit('daemon.start', { daemonId: opts.daemonId || 'pending', ...opts, wsPort: WS_PORT, httpPort: HTTP_PORT });

  // Create HTTP server
  httpServer = createHttpServer();
  
  // Handle port errors for HTTP server
  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[camo daemon] Fatal: HTTP port ${HTTP_PORT} is already in use`);
      console.error(`[camo daemon] Set CAMO_HTTP_PORT to a different port or use port 0 for auto-assignment`);
      shutdown(2);
    } else if (err.code === 'EACCES') {
      console.error(`[camo daemon] Fatal: permission denied for HTTP port ${HTTP_PORT}`);
      shutdown(2);
    } else {
      console.error(`[camo daemon] HTTP server error: ${err.message}`);
      shutdown(1);
    }
  });

  httpServer.listen(HTTP_PORT, () => {
    const actualHttpPort = httpServer.address().port;
    emit('http.start', { port: actualHttpPort });
    console.error(`[camo daemon] HTTP http://localhost:${actualHttpPort}`);
    
    // Create WS server after HTTP is ready
    wsServer = createWsServer();
    
    // Handle WS server port errors
    wsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[camo daemon] Fatal: WS port ${WS_PORT} is already in use`);
        console.error(`[camo daemon] Set CAMO_WS_PORT to a different port or use port 0 for auto-assignment`);
        shutdown(2);
      } else if (err.code === 'EACCES') {
        console.error(`[camo daemon] Fatal: permission denied for WS port ${WS_PORT}`);
        shutdown(2);
      } else {
        console.error(`[camo daemon] WS server error: ${err.message}`);
        shutdown(1);
      }
    });
    
    // Register daemon with actual ports
    const actualWsPort = () => {
      try { return wsServer.address().port; } catch { return WS_PORT; }
    };
    
    // Wait for WS server to be ready
    wsServer.on('listening', () => {
      const actualWsPort = wsServer.address().port;
      const reg = registerDaemon(actualWsPort, actualHttpPort, opts.profile, opts.mode);
      opts.daemonId = reg.daemonId;
      opts.daemonRegistration = reg;
      
      emit('ws.start', { port: actualWsPort });
      console.error(`[camo daemon] WS ws://localhost:${actualWsPort}`);
      console.error(`[camo daemon] Mode=${opts.mode}, Profile=${opts.profile}, DaemonId=${reg.daemonId}`);
    });
  });

  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  
  // For ephemeral mode, auto-shutdown after a timeout if no commands
  if (opts.mode === 'ephemeral') {
    const idleTimeout = parseInt(process.env.CAMO_EPHEMERAL_IDLE_TIMEOUT || '30000', 10);
    let idleTimer = setTimeout(() => {
      if (browserRefCount === 0) {
        shutdown(0);
      }
    }, idleTimeout);
    
    // Reset idle timer on each command
    const origHandleCommand = handleCommand;
    // We'll let the daemon stay alive; CLI will shut it down after the command
  }
}

main(process.argv).catch((e) => {
  console.error(`[camo daemon] fatal: ${e?.message || String(e)}`);
  shutdown(1);
});
