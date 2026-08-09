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
import { CamoError, project as projectError } from '../../contracts/error_envelope/projector.mjs';
import { build, parse } from '../../contracts/ws_messages/v1/envelope.mjs';
import { append as appendProgress } from '../../services/progress_event/log.mjs';
import { 
  startSession, 
  stopSession, 
  getSession,
  shutdown as shutdownBrowserService,
  __enableTestRoot as enableBrowserServiceTest,
  enableAllOwners as enableAllBrowserOwners
} from '../../services/browser_service/bootstrap.mjs';
import {
  claimDaemonSlot,
  registerDaemon,
  releaseDaemonSlot,
  unregisterDaemon,
} from '../../services/daemon_registration/registry.mjs';
import { handleCommand as dispatchCommand } from './command_handlers.mjs';
import { isBrowserCommand } from './browser_commands.mjs';
import { shutdownDaemonResources } from './shutdown_policy.mjs';

// --- Configuration ---
const WS_PORT = parseInt(process.env.CAMO_WS_PORT || '0', 10);
const HTTP_PORT = parseInt(process.env.CAMO_HTTP_PORT || '0', 10);
const DEFAULT_PROFILE = process.env.CAMO_PROFILE || '_ephemeral_';

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
let _currentBrowserState = null;
let browserOwnersEnabled = false;

async function ensureBrowser(profile, forcePersistent) {
  const targetProfile = profile || opts.profile;
  const { getBrowser } = await import('../../services/browser_service/internal/camoufox_bridge.mjs');
  
  if (opts.mode === 'ephemeral' || forcePersistent) {
    if (currentBrowserProfile !== targetProfile || browserRefCount === 0) {
      if (currentBrowserProfile && currentBrowserProfile !== targetProfile) {
        await stopSession(currentBrowserProfile);
      }
      await startSession({ profileId: targetProfile, headless: opts.mode === 'headless' });
      currentBrowserProfile = targetProfile;
      if (_currentBrowserState) _currentBrowserState.currentBrowserProfile = targetProfile;
    }
    browserRefCount++;
    if (_currentBrowserState) _currentBrowserState.browserRefCount = browserRefCount;
    return targetProfile;
  }
  
  if (!currentBrowserProfile || currentBrowserProfile !== targetProfile) {
    if (!getBrowser(targetProfile)) {
      await startSession({ profileId: targetProfile, headless: opts.mode === 'headless' });
    }
    currentBrowserProfile = targetProfile;
    browserRefCount = 1;
    if (_currentBrowserState) _currentBrowserState.currentBrowserProfile = targetProfile;
  } else {
    browserRefCount++;
  }
  if (_currentBrowserState) _currentBrowserState.browserRefCount = browserRefCount;
  return currentBrowserProfile;
}

async function releaseBrowser(forceClose) {
  if (opts.mode === 'ephemeral' || forceClose) {
    if (currentBrowserProfile) {
      await stopSession(currentBrowserProfile);
      currentBrowserProfile = null;
      browserRefCount = 0;
      if (_currentBrowserState) _currentBrowserState.currentBrowserProfile = null;
    }
  } else {
    browserRefCount = Math.max(0, browserRefCount - 1);
  }
  if (_currentBrowserState) _currentBrowserState.browserRefCount = browserRefCount;
}

// --- Command dispatch ---
async function handleCommand(env) {
  const { cmd, args = {} } = env.payload || {};
  const profile = args.profile || opts.profile;
  const isEphemeral = profile.startsWith('_ephemeral_') || opts.mode === 'ephemeral';
  const startedAt = Date.now();

  emit('command.start', { cmd, args, profile, ephemeral: isEphemeral });

  let result = null;
  let commandError = null;
  try {
    const browserState = { currentBrowserProfile, browserRefCount };
    _currentBrowserState = browserState;
    const commandResult = await dispatchCommand(cmd, args, {
      profile,
      isEphemeral,
      opts,
      ensureBrowser,
      releaseBrowser,
      browserState,
    });

    // Sync back browser state changes
    currentBrowserProfile = browserState.currentBrowserProfile;
    browserRefCount = browserState.browserRefCount;

    result = { kind: 'result', payload: { cmd, ...commandResult } };
  } catch (cause) {
    commandError = cause;
  }

  if (isEphemeral && isBrowserCommand(cmd)) {
    try {
      await releaseBrowser(true);
    } catch (cause) {
      commandError ||= cause;
      result = null;
    }
  }

  if (commandError) {
    const proj = commandError instanceof CamoError ? commandError : new CamoError({
      code: 'E_INTERNAL_UNEXPECTED',
      message: commandError?.message || String(commandError),
      cause: commandError,
    });
    const projected = projectError(proj);
    emit('command.error', { cmd, profile, error: projected });
    return { kind: 'error', payload: projected };
  }

  emit('command.done', { cmd, profile, durationMs: Date.now() - startedAt });
  return result;
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
let daemonClaim = null;

function closeServer(server) {
  if (!server) return Promise.resolve();
  for (const client of server.clients || []) client.terminate();
  server.closeAllConnections?.();
  return new Promise((resolve, reject) => {
    server.close((cause) => {
      if (cause) reject(cause);
      else resolve();
    });
  });
}

export async function closeProtocolServers() {
  await closeServer(wsServer);
  await closeServer(httpServer);
  wsServer = null;
  httpServer = null;
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  
  emit('daemon.shutdown', { code });
  
  const result = await shutdownDaemonResources({
    shutdownBrowsers: async () => {
      if (browserOwnersEnabled) await shutdownBrowserService();
    },
    clearBrowserTruth: () => {
      currentBrowserProfile = null;
      browserRefCount = 0;
      _currentBrowserState = null;
    },
    closeServers: closeProtocolServers,
    releaseRegistration: () => {
      if (!daemonClaim) return;
      if (opts.daemonId) unregisterDaemon(opts.daemonId, daemonClaim);
      else releaseDaemonSlot(daemonClaim);
      daemonClaim = null;
    },
  });
  if (!result.ok) {
    console.error(`[camo daemon] shutdown failed at ${result.stage}: ${result.cause?.message || String(result.cause)}`);
    process.exitCode = 1;
    return;
  }
  process.exit(code);
}

// --- Main ---
async function main(argv) {
  opts = parseArgs(argv);
  daemonClaim = claimDaemonSlot();
  
  enableBrowserServiceTest();
  await enableAllBrowserOwners();
  browserOwnersEnabled = true;
  
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
    
    // Wait for WS server to be ready
    wsServer.on('listening', () => {
      const actualWsPort = wsServer.address().port;
      const reg = registerDaemon({
        claim: daemonClaim,
        wsPort: actualWsPort,
        httpPort: actualHttpPort,
        headless: opts.mode === 'headless',
        mode: opts.mode,
      });
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
    
  }
}

await main(process.argv).catch(async (e) => {
  const fatal = e instanceof CamoError ? projectError(e) : null;
  console.error(`[camo daemon] fatal: ${fatal?.message || e?.message || String(e)}`);
  await shutdown(1);
});
