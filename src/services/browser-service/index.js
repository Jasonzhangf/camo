import http from 'http';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { SessionManager, SESSION_CLOSED_EVENT, } from './internal/SessionManager.js';
import { BrowserWsServer } from './internal/ws-server.js';
import { logDebug } from './internal/logging.js';
import { installServiceProcessLogger } from './internal/service-process-logger.js';
import { startHeartbeatWriter } from './internal/heartbeat.js';
const clients = new Set();
const autoLoops = new Map();
function readNumber(value) {
    if (!value)
        return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return null;
    return parsed;
}
function readPositiveNumber(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return null;
    return parsed;
}
function getDisplayMetrics() {
    const envWidth = readNumber(process.env.CAMO_SCREEN_WIDTH || process.env.CAMO_SCREEN_WIDTH);
    const envHeight = readNumber(process.env.CAMO_SCREEN_HEIGHT || process.env.CAMO_SCREEN_HEIGHT);
    if (envWidth && envHeight) {
        return { width: envWidth, height: envHeight, source: 'env' };
    }
    if (os.platform() === 'darwin') {
        try {
            const sp = spawnSync('system_profiler', ['SPDisplaysDataType', '-json'], { encoding: 'utf8' });
            const spJson = sp.status === 0 && sp.stdout ? JSON.parse(sp.stdout) : null;
            let width = null;
            let height = null;
            const displays = spJson?.SPDisplaysDataType;
            if (Array.isArray(displays) && displays.length > 0) {
                const first = displays[0];
                const gpus = first?._items;
                const maybe = Array.isArray(gpus) && gpus.length > 0 ? gpus[0] : first;
                const resStr = maybe?.spdisplays_ndrvs?.[0]?._spdisplays_resolution || maybe?._spdisplays_resolution;
                if (typeof resStr === 'string') {
                    const m = resStr.match(/(\d+)\s*x\s*(\d+)/i);
                    if (m) {
                        width = readNumber(m[1]);
                        height = readNumber(m[2]);
                    }
                }
            }
            const osascript = spawnSync('osascript', [
                '-l',
                'JavaScript',
                '-e',
                `ObjC.import('AppKit');
           const s = $.NSScreen.mainScreen;
           const f = s.frame;
           const v = s.visibleFrame;
           JSON.stringify({
             width: Number(f.size.width),
             height: Number(f.size.height),
             workWidth: Number(v.size.width),
             workHeight: Number(v.size.height)
           });`,
            ], { encoding: 'utf8' });
            const vf = osascript.status === 0 && osascript.stdout ? JSON.parse(osascript.stdout.trim()) : null;
            const finalW = readNumber(vf?.width) || width;
            const finalH = readNumber(vf?.height) || height;
            const workWidth = readNumber(vf?.workWidth);
            const workHeight = readNumber(vf?.workHeight);
            if (!finalW || !finalH)
                return null;
            return {
                width: finalW,
                height: finalH,
                ...(workWidth ? { workWidth } : {}),
                ...(workHeight ? { workHeight } : {}),
                source: 'darwin',
            };
        }
        catch {
            return null;
        }
    }
    if (os.platform() !== 'win32')
        return null;
    try {
        const script = [
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$screen=[System.Windows.Forms.Screen]::PrimaryScreen;',
            '$b=$screen.Bounds;',
            '$w=$screen.WorkingArea;',
            '$video=Get-CimInstance Win32_VideoController | Select-Object -First 1;',
            '$nw=$null;$nh=$null;',
            'if ($video) { $nw=$video.CurrentHorizontalResolution; $nh=$video.CurrentVerticalResolution }',
            '$o=[pscustomobject]@{width=$b.Width;height=$b.Height;workWidth=$w.Width;workHeight=$w.Height;nativeWidth=$nw;nativeHeight=$nh};',
            '$o | ConvertTo-Json -Compress',
        ].join(' ');
        const res = spawnSync('powershell', ['-NoProfile', '-Command', script], {
            encoding: 'utf8',
            windowsHide: true,
        });
        if (res.status !== 0 || !res.stdout)
            return null;
        const payload = JSON.parse(res.stdout.trim());
        const nativeWidth = readNumber(payload?.nativeWidth);
        const nativeHeight = readNumber(payload?.nativeHeight);
        const width = readNumber(payload?.width) || nativeWidth || null;
        const height = readNumber(payload?.height) || nativeHeight || null;
        const workWidth = readNumber(payload?.workWidth);
        const workHeight = readNumber(payload?.workHeight);
        if (!width || !height)
            return null;
        return {
            width,
            height,
            ...(workWidth ? { workWidth } : {}),
            ...(workHeight ? { workHeight } : {}),
            ...(nativeWidth ? { nativeWidth } : {}),
            ...(nativeHeight ? { nativeHeight } : {}),
            source: 'win32',
        };
    }
    catch {
        return null;
    }
}
function resolveStartViewport(args) {
    const explicitWidth = readPositiveNumber(args?.width ?? args?.viewportWidth ?? args?.viewport?.width);
    const explicitHeight = readPositiveNumber(args?.height ?? args?.viewportHeight ?? args?.viewport?.height);
    if (explicitWidth && explicitHeight) {
        return {
            width: Math.floor(explicitWidth),
            height: Math.floor(explicitHeight),
        };
    }
    if (Boolean(args?.headless))
        return null;
    const display = getDisplayMetrics();
    if (!display)
        return null;
    const reserveRaw = Number(process.env.CAMO_WINDOW_VERTICAL_RESERVE ?? process.env.CAMO_WINDOW_VERTICAL_RESERVE ?? 0);
    const reserve = Number.isFinite(reserveRaw) ? Math.max(0, Math.min(240, Math.floor(reserveRaw))) : 0;
    const baseWidth = readPositiveNumber(display.workWidth) || readPositiveNumber(display.width);
    const baseHeight = readPositiveNumber(display.workHeight) || readPositiveNumber(display.height);
    if (!baseWidth || !baseHeight)
        return null;
    return {
        width: Math.max(960, Math.floor(baseWidth)),
        height: Math.max(700, Math.floor(baseHeight - reserve)),
    };
}
export async function startBrowserService(opts = {}) {
    const { logEvent } = installServiceProcessLogger({ serviceName: 'browser-service' });
    const host = opts.host || process.env.CAMO_BROWSER_HTTP_HOST || '127.0.0.1';
    const port = Number(opts.port || process.env.CAMO_BROWSER_HTTP_PORT || 7704);
    const sessionManager = new SessionManager();
    const enableWs = opts.enableWs ?? process.env.CAMO_BROWSER_DISABLE_WS !== '1';
    const wsHost = opts.wsHost || process.env.CAMO_WS_HOST || '127.0.0.1';
    const wsPort = Number(opts.wsPort || process.env.CAMO_WS_PORT || 8765);
    const autoExit = process.env.CAMO_BROWSER_AUTO_EXIT === '1';
    const heartbeat = startHeartbeatWriter({ initialStatus: 'idle' });
    let heartbeatStatus = 'idle';
    let hasActiveSession = false;
    const setHeartbeatStatus = (next) => {
        if (heartbeatStatus === next)
            return;
        heartbeatStatus = next;
        heartbeat.setStatus(next);
    };
    const markSessionStarted = () => {
        hasActiveSession = true;
        setHeartbeatStatus('running');
    };
    const markAllSessionsClosed = () => {
        if (!hasActiveSession)
            return;
        setHeartbeatStatus('stopped');
    };
    logDebug('browser-service', 'start', { host, port, wsHost, wsPort, enableWs, autoExit });
    let wsServer = null;
    const server = http.createServer((req, res) => {
        void (async () => {
            const url = new URL(req.url || '/', `http://${req.headers.host}`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }
            if (url.pathname === '/health') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));
                return;
            }
            if (url.pathname === '/events') {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    Connection: 'keep-alive',
                    'Cache-Control': 'no-cache',
                });
                clients.add(res);
                req.on('close', () => clients.delete(res));
                return;
            }
            if (url.pathname === '/command' && req.method === 'POST') {
                const chunks = [];
                req.on('data', (chunk) => chunks.push(chunk));
                req.on('end', async () => {
                    try {
                        const payload = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
                        const t0 = Date.now();
                        const action = String(payload?.action || '');
                        const profileId = String(payload?.args?.profileId || payload?.args?.profile || payload?.args?.sessionId || '');
                        logEvent('browser.command.start', { action, profileId });
                        const result = await handleCommand(payload, sessionManager, wsServer, { onSessionStart: markSessionStarted });
                        logEvent('browser.command.done', { action, profileId, ok: result.ok, ms: Date.now() - t0 });
                        res.writeHead(result.ok ? 200 : 500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result.body));
                    }
                    catch (err) {
                        logEvent('browser.command.error', { error: err?.message || String(err) });
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message }));
                    }
                });
                return;
            }
            res.writeHead(404);
            res.end();
        })().catch((err) => {
            logEvent('http.request.error', {
                method: req?.method,
                url: req?.url,
                error: { message: err?.message || String(err), stack: err?.stack },
            });
            try {
                if (!res.headersSent)
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, error: 'Internal Server Error' }));
            }
            catch {
                // ignore
            }
        });
    });
    server.listen(port, host, () => {
        console.log(`BrowserService listening on http://${host}:${port}`);
    });
    if (enableWs) {
        wsServer = new BrowserWsServer({ host: wsHost, port: wsPort, sessionManager });
        try {
            await wsServer.start();
        }
        catch (err) {
            console.warn('[browser-service] failed to start WebSocket server:', err.message);
        }
    }
    const stopWsServer = async () => {
        if (!wsServer)
            return;
        await wsServer.stop().catch(() => { });
    };
    const shutdown = async () => {
        heartbeat.stop();
        server.close();
        clients.forEach((client) => client.end());
        autoLoops.forEach((timer) => clearInterval(timer));
        await stopWsServer();
        await sessionManager.shutdown();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    process.on(SESSION_CLOSED_EVENT, () => {
        if (!managerIsIdle(sessionManager))
            return;
        markAllSessionsClosed();
        if (autoExit || hasActiveSession) {
            shutdown().finally(() => process.exit(0));
        }
    });
}
function managerIsIdle(manager) {
    return manager.listSessions().length === 0;
}
async function handleCommand(payload, manager, wsServer, options = {}) {
    const action = payload.action;
    const args = payload.args ?? payload;
    switch (action) {
        case 'start': {
            const startViewport = resolveStartViewport(args);
            const opts = {
                profileId: args.profileId || 'default',
                sessionName: args.profileId || 'default',
                headless: !!args.headless,
                initialUrl: args.url,
                engine: args.engine || 'camoufox',
                fingerprintPlatform: args.fingerprintPlatform || null,
                ...(startViewport ? { viewport: startViewport } : {}),
                ...(args.ownerPid ? { ownerPid: args.ownerPid } : {}),
            };
            const res = await manager.createSession(opts);
            const session = manager.getSession(opts.profileId);
            if (!session) {
                throw new Error(`session for profile ${opts.profileId} not started`);
            }
            let recording = null;
            if (args.record === true || args.recording === true) {
                recording = await session.startRecording({
                    name: args.recordName || args.recordingName,
                    outputPath: args.recordOutput || args.recordingOutput || args.recordOutputPath,
                    overlay: typeof args.recordOverlay === 'boolean' ? args.recordOverlay : undefined,
                });
            }
            options.onSessionStart?.();
            broadcast('browser:started', { profileId: opts.profileId, sessionId: res.sessionId });
            return {
                ok: true,
                body: {
                    ok: true,
                    sessionId: res.sessionId,
                    profileId: opts.profileId,
                    ...(recording ? { recording } : {}),
                },
            };
        }
        case 'goto': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            await session.goto(args.url);
            broadcast('page:navigated', { profileId, url: args.url });
            return { ok: true, body: { ok: true } };
        }
        case 'getCookies': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const cookies = await session.getCookies();
            return { ok: true, body: { ok: true, cookies } };
        }
        case 'saveCookies': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            if (!args.path)
                throw new Error('path required');
            const result = await session.saveCookiesToFile(args.path);
            return { ok: true, body: { ok: true, ...result } };
        }
        case 'saveCookiesIfStable': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            if (!args.path)
                throw new Error('path required');
            const result = await session.saveCookiesIfStable(args.path, { minDelayMs: args.minDelayMs });
            return { ok: true, body: { ok: true, saved: !!result, ...result } };
        }
        case 'loadCookies': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            if (!args.path)
                throw new Error('path required');
            const result = await session.injectCookiesFromFile(args.path);
            return { ok: true, body: { ok: true, ...result } };
        }
        case 'getStatus': {
            return { ok: true, body: { ok: true, sessions: manager.listSessions() } };
        }
        case 'record:start': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const recording = await session.startRecording({
                name: args.name || args.recordName,
                outputPath: args.outputPath || args.output || args.recordOutput,
                overlay: typeof args.overlay === 'boolean' ? args.overlay : undefined,
            });
            return { ok: true, body: { ok: true, profileId, recording } };
        }
        case 'record:stop': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const recording = await session.stopRecording({ reason: String(args.reason || 'manual') });
            return { ok: true, body: { ok: true, profileId, recording } };
        }
        case 'record:status': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const recording = session.getRecordingStatus();
            return { ok: true, body: { ok: true, profileId, recording } };
        }
        case 'system:display': {
            const metrics = getDisplayMetrics();
            return { ok: true, body: { ok: true, metrics: metrics || null } };
        }
        case 'window:move': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const { x, y } = args;
            await session.evaluate(`window.moveTo(${x}, ${y})`);
            return { ok: true, body: { ok: true } };
        }
        case 'window:resize': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const { width, height } = args;
            await session.evaluate(`window.resizeTo(${width}, ${height})`);
            return { ok: true, body: { ok: true } };
        }
        case 'stop': {
            const profileId = args.profileId || 'default';
            const deleted = await manager.deleteSession(profileId);
            return { ok: true, body: { ok: deleted } };
        }
        case 'service:shutdown': {
            console.log('[BrowserService] Received shutdown command, gracefully terminating...');
            const response = { ok: true, body: { message: 'Browser service shutting down' } };
            setImmediate(async () => {
                try {
                    if (wsServer) {
                        await wsServer.stop().catch(() => { });
                    }
                    await manager.shutdown();
                    console.log('[BrowserService] Shutdown complete');
                    process.exit(0);
                }
                catch (err) {
                    console.error('[BrowserService] Error during shutdown:', err);
                    process.exit(1);
                }
            });
            return response;
        }
        case 'screenshot': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const buffer = await session.screenshot(!!args.fullPage);
            return { ok: true, body: { success: true, data: buffer.toString('base64') } };
        }
        case 'evaluate': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const script = args.script;
            if (!script || typeof script !== 'string')
                throw new Error('script (string) is required');
            const result = await session.evaluate(script);
            return { ok: true, body: { ok: true, result } };
        }
        case 'page:list': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const pages = session.listPages();
            const activeIndex = pages.find((p) => p.active)?.index ?? 0;
            return { ok: true, body: { ok: true, pages, activeIndex } };
        }
        case 'page:new':
        case 'newPage': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const url = args.url ? String(args.url) : undefined;
            const strictShortcut = args.strictShortcut === true;
            const result = await session.newPage(url, { strictShortcut });
            broadcast('page:created', { profileId, index: result.index, url: result.url });
            return { ok: true, body: { ok: true, ...result } };
        }
        case 'page:switch':
        case 'switchControl': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const index = Number(args.index);
            const result = await session.switchPage(index);
            broadcast('page:switched', { profileId, index: result.index, url: result.url });
            return { ok: true, body: { ok: true, ...result } };
        }
        case 'page:close': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const hasIndex = typeof args.index !== 'undefined' && args.index !== null;
            const index = hasIndex ? Number(args.index) : undefined;
            const result = await session.closePage(index);
            broadcast('page:closed', { profileId, closedIndex: result.closedIndex, activeIndex: result.activeIndex });
            return { ok: true, body: { ok: true, ...result } };
        }
        case 'page:back': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const result = await session.goBack();
            broadcast('page:navigated', { profileId, url: result.url, via: 'page:back' });
            return { ok: true, body: { ok: true, ...result } };
        }
        case 'page:setViewport': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const width = Number(args.width);
            const height = Number(args.height);
            const size = await session.setViewportSize({ width, height });
            broadcast('page:viewport', { profileId, ...size });
            return { ok: true, body: { ok: true, ...size } };
        }
        case 'autoCookies:start': {
            const profileId = args.profileId || 'default';
            const interval = Math.max(1000, Number(args.intervalMs) || 2500);
            const existing = autoLoops.get(profileId);
            if (existing)
                clearInterval(existing);
            const timer = setInterval(async () => {
                const session = manager.getSession(profileId);
                if (!session)
                    return;
                try {
                    await session.saveCookiesForActivePage();
                }
                catch {
                    // ignore
                }
            }, interval);
            autoLoops.set(profileId, timer);
            return { ok: true, body: { ok: true } };
        }
        case 'autoCookies:stop': {
            const profileId = args.profileId || 'default';
            const timer = autoLoops.get(profileId);
            if (timer)
                clearInterval(timer);
            autoLoops.delete(profileId);
            return { ok: true, body: { ok: true } };
        }
        case 'autoCookies:status': {
            const profileId = args.profileId || 'default';
            return { ok: true, body: { ok: !!autoLoops.get(profileId) } };
        }
        case 'mouse:click': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const { x, y, button, clicks, delay, nudgeBefore } = args;
            await session.mouseClick({ x: Number(x), y: Number(y), button, clicks, delay, nudgeBefore: nudgeBefore === true });
            return { ok: true, body: { ok: true } };
        }
        case 'mouse:move': {
            throw new Error('mouse:move disabled');
        }
        case 'mouse:wheel': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const { deltaY, deltaX, anchorX, anchorY } = args;
            await session.mouseWheel({
                deltaY: Number(deltaY) || 0,
                deltaX: Number(deltaX) || 0,
                ...(Number.isFinite(Number(anchorX)) && Number.isFinite(Number(anchorY))
                    ? { anchorX: Number(anchorX), anchorY: Number(anchorY) }
                    : {}),
            });
            return { ok: true, body: { ok: true } };
        }
        case 'keyboard:type': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const { text, delay, submit } = args;
            await session.keyboardType({
                text: String(text ?? ''),
                delay: typeof delay === 'number' ? delay : undefined,
                submit: !!submit,
            });
            return { ok: true, body: { ok: true } };
        }
        case 'keyboard:press': {
            const profileId = args.profileId || 'default';
            const session = manager.getSession(profileId);
            if (!session)
                throw new Error(`session for profile ${profileId} not started`);
            const { key, delay } = args;
            await session.keyboardPress({
                key: String(key ?? 'Enter'),
                delay: typeof delay === 'number' ? delay : undefined,
            });
            return { ok: true, body: { ok: true } };
        }
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients.forEach((client) => {
        try {
            client.write(payload);
        }
        catch {
            clients.delete(client);
        }
    });
}
export function parseBrowserServiceCliArgs(argv = process.argv) {
    const hostArg = argv.indexOf('--host');
    const portArg = argv.indexOf('--port');
    const wsPortArg = argv.indexOf('--ws-port');
    const wsHostArg = argv.indexOf('--ws-host');
    const busUrlArg = argv.indexOf('--bus-url');
    const disableWs = argv.includes('--no-ws');
    return {
        host: hostArg >= 0 ? argv[hostArg + 1] : '127.0.0.1',
        port: portArg >= 0 ? Number(argv[portArg + 1]) : 7704,
        wsPort: wsPortArg >= 0 ? Number(argv[wsPortArg + 1]) : 8765,
        wsHost: wsHostArg >= 0 ? argv[wsHostArg + 1] : '127.0.0.1',
        busUrl: busUrlArg >= 0 ? argv[busUrlArg + 1] : undefined,
        enableWs: !disableWs,
    };
}
export async function runBrowserServiceCli(argv = process.argv) {
    await startBrowserService(parseBrowserServiceCliArgs(argv));
}
if (fileURLToPath(import.meta.url) === process.argv[1]) {
    void runBrowserServiceCli(process.argv);
}
//# sourceMappingURL=index.js.map
