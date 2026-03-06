import fs from 'fs';
import path from 'path';
import os from 'os';
import { WebSocketServer } from 'ws';
import { SESSION_CLOSED_EVENT } from './SessionManager.js';
import { ContainerMatcher } from './container-matcher.js';
import { ensurePageRuntime } from './pageRuntime.js';
import { logDebug } from './logging.js';
import { CONFIG_DIR } from '../../../utils/config.mjs';
const logsDir = path.join(CONFIG_DIR || path.join(os.homedir(), '.camo'), 'logs');
const domPickerLogPath = path.join(logsDir, 'dom-picker-debug.log');
const highlightLogPath = path.join(logsDir, 'highlight-debug.log');
function appendLog(target, event, payload = {}) {
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            event,
            ...payload,
        });
        fs.appendFileSync(target, `${line}\n`, 'utf-8');
    }
    catch {
        /* ignore log errors */
    }
}
const appendDomPickerLog = (event, payload = {}) => appendLog(domPickerLogPath, event, payload);
const appendHighlightLog = (event, payload = {}) => appendLog(highlightLogPath, event, payload);
function legacySelectorActionDisabled(source, action) {
    return {
        success: false,
        code: 'LEGACY_ACTION_DISABLED',
        error: `[${source}] legacy selector action "${action}" is disabled; use mouse:* and keyboard:* protocol actions instead`,
        data: {
            source,
            action,
            replacements: ['mouse:move', 'mouse:click', 'mouse:wheel', 'keyboard:press', 'keyboard:type'],
        },
    };
}
export class BrowserWsServer {
    options;
    wss;
    matcher = new ContainerMatcher();
    capabilityMap = new Map();
    subscriptions = new Map();
    sessionSubscribers = new Map();
    runtimeBridgeUnsub = new Map();
    constructor(options) {
        this.options = options;
        process.on(SESSION_CLOSED_EVENT, (sessionId) => {
            this.teardownRuntimeEventBridge(sessionId);
        });
    }
    async start() {
        if (this.wss)
            return;
        const host = this.options.host || '127.0.0.1';
        const port = Number(this.options.port || 8765);
        this.wss = new WebSocketServer({ host, port });
        this.wss.on('connection', (socket) => {
            this.subscriptions.set(socket, new Set());
            socket.on('message', (data) => this.handleMessage(socket, data));
            socket.on('close', () => {
                this.handleSocketClose(socket);
            });
        });
        this.wss.on('listening', () => {
            console.log(`[browser-ws] listening on ws://${host}:${port}`);
        });
        this.wss.on('error', (err) => {
            console.error('[browser-ws] server error:', err);
        });
    }
    async handleDomPick(session, parameters) {
        const timeoutMs = Math.min(Math.max(Number(parameters?.timeout) || 25000, 3000), 60000);
        const page = await session.ensurePage();
        const sessionId = session?.id || 'unknown';
        appendDomPickerLog('start', { sessionId, timeoutMs });
        await ensurePageRuntime(page);
        try {
            await page.bringToFront();
        }
        catch {
            /* ignore */
        }
        const hasRuntime = await page.evaluate(() => {
            const w = window;
            return Boolean(w.__domPicker && typeof w.__domPicker.startSession === 'function' && typeof w.__domPicker.getLastState === 'function');
        });
        if (!hasRuntime) {
            appendDomPickerLog('runtime-missing', { sessionId });
            return {
                success: false,
                error: 'domPicker runtime unavailable',
                cancelled: false,
                timeout: false,
            };
        }
        const rootSelector = parameters.root_selector || parameters.rootSelector || null;
        await page.evaluate((opts) => {
            const w = window;
            try {
                w.__domPicker.startSession({ mode: 'hover-select', timeoutMs: opts.timeoutMs, rootSelector: opts.rootSelector });
            }
            catch (err) {
                // swallow, polling below will observe error/idle state
                // eslint-disable-next-line no-console
                console.warn('[dom-picker] startSession error', err);
            }
        }, { timeoutMs, rootSelector });
        const startedState = await page.evaluate(() => {
            const w = window;
            return w.__domPicker ? w.__domPicker.getLastState() : null;
        });
        appendDomPickerLog('started', { sessionId, state: startedState });
        const startedAt = Date.now();
        const hardTimeout = timeoutMs + 2000;
        // Poll state until selected / cancelled / timeout
        // We keep polling even after logical timeoutMs so that page-side timeout can mark phase = 'timeout'.
        while (true) {
            const elapsed = Date.now() - startedAt;
            if (elapsed > hardTimeout) {
                appendDomPickerLog('hard-timeout', { sessionId, elapsed });
                return {
                    success: false,
                    error: 'domPicker hard timeout',
                    cancelled: false,
                    timeout: true,
                };
            }
            const state = await page.evaluate(() => {
                const w = window;
                return w.__domPicker ? w.__domPicker.getLastState() : null;
            });
            if (!state) {
                appendDomPickerLog('state-missing', { sessionId });
                return {
                    success: false,
                    error: 'domPicker state unavailable',
                    cancelled: false,
                    timeout: false,
                };
            }
            const phase = state.phase;
            if (phase === 'selected' && state.selection) {
                const sel = state.selection;
                appendDomPickerLog('selected', { sessionId, selection: sel });
                this.broadcastEvent('dom.picker.result', sessionId, {
                    success: true,
                    dom_path: sel.path || '',
                    selector: sel.selector || '',
                    bounding_rect: sel.rect || { x: 0, y: 0, width: 0, height: 0 },
                    tag: sel.tag || '',
                    id: sel.id || null,
                    classes: Array.isArray(sel.classes) ? sel.classes : [],
                    text: sel.text || '',
                });
                return {
                    success: true,
                    dom_path: sel.path || '',
                    selector: sel.selector || '',
                    bounding_rect: sel.rect || { x: 0, y: 0, width: 0, height: 0 },
                    tag: sel.tag || '',
                    id: sel.id || null,
                    classes: Array.isArray(sel.classes) ? sel.classes : [],
                    text: sel.text || '',
                    cancelled: false,
                    timeout: false,
                };
            }
            if (phase === 'cancelled') {
                appendDomPickerLog('cancelled', { sessionId });
                return {
                    success: false,
                    error: state.error || 'cancelled',
                    dom_path: null,
                    selector: null,
                    bounding_rect: null,
                    tag: null,
                    id: null,
                    classes: [],
                    text: '',
                    cancelled: true,
                    timeout: false,
                };
            }
            if (phase === 'timeout') {
                appendDomPickerLog('timeout', { sessionId });
                return {
                    success: false,
                    error: state.error || 'timeout',
                    dom_path: null,
                    selector: null,
                    bounding_rect: null,
                    tag: null,
                    id: null,
                    classes: [],
                    text: '',
                    cancelled: false,
                    timeout: true,
                };
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }
    async stop() {
        if (!this.wss)
            return;
        await new Promise((resolve) => this.wss?.close(() => resolve()));
        this.wss = undefined;
    }
    async handleDomPickerLoopback(session, parameters) {
        const page = await session.ensurePage();
        const selector = parameters.selector || 'body';
        const timeoutMs = Math.min(Math.max(Number(parameters?.timeout) || 10000, 1000), 60000);
        const settleMs = Math.min(Math.max(Number(parameters?.settle_ms) || 32, 0), 2000);
        const sessionId = session?.id || 'unknown';
        appendDomPickerLog('loopback_start', { sessionId, selector, timeoutMs, settleMs });
        await ensurePageRuntime(page);
        // Real loopback: compute element center, move the real browser mouse, then read picker state.
        const prep = await page.evaluate((sel) => {
            const runtime = window.__camoRuntime;
            const picker = window.__domPicker;
            if (!runtime || !runtime.ready) {
                return { ok: false, error: '__camoRuntime not ready' };
            }
            if (!picker || typeof picker.startSession !== 'function' || typeof picker.getLastState !== 'function') {
                return { ok: false, error: '__domPicker unavailable' };
            }
            const info = picker.findElementCenter ? picker.findElementCenter(sel) : null;
            const el = typeof sel === 'string' ? document.querySelector(sel) : null;
            if (!info || !info.found || !el) {
                return { ok: false, error: 'selector_not_found' };
            }
            const point = { x: Math.round(info.x), y: Math.round(info.y) };
            const rect = info.rect;
            const buildPath = runtime?.dom?.buildPathForElement;
            const targetPath = buildPath && el instanceof Element ? buildPath(el, null) : null;
            const fromPoint = document.elementFromPoint(point.x, point.y);
            const fromPointPath = buildPath && fromPoint instanceof Element ? buildPath(fromPoint, null) : null;
            const before = picker.getLastState();
            if (!before?.phase || before.phase === 'idle') {
                picker.startSession({ timeoutMs: 8000 });
            }
            return {
                ok: true,
                selector: sel,
                point,
                targetRect: rect,
                targetPath,
                fromPointPath,
                stateBefore: before,
            };
        }, selector);
        if (!prep?.ok) {
            appendDomPickerLog('loopback_runtime_missing', { sessionId, selector, error: prep?.error });
            return { success: false, error: prep?.error || 'loopback_prep_failed' };
        }
        // mouse:move is globally disabled for runtime stability.
        if (settleMs > 0) {
            await new Promise((r) => setTimeout(r, settleMs));
        }
        const after = await page.evaluate(() => {
            const picker = window.__domPicker;
            return picker?.getLastState?.() || null;
        });
        await page.evaluate((sel) => {
            const runtime = window.__camoRuntime;
            runtime?.highlight?.highlightSelector?.(sel, { persistent: true, channel: 'dom-picker-loopback' });
        }, prep.selector);
        const result = {
            selector: prep.selector,
            point: prep.point,
            targetRect: prep.targetRect,
            hoveredPath: after?.selection?.path || after?.hovered?.path || after?.selected?.path || after?.path || null,
            targetPath: prep.targetPath,
            fromPointPath: prep.fromPointPath,
            overlayRect: after?.selection?.rect || after?.hovered?.rect || after?.selected?.rect || after?.rect || null,
            stateBefore: prep.stateBefore,
            stateAfter: after,
            matches: Boolean(prep.targetPath) &&
                (after?.selection?.path || after?.hovered?.path || after?.selected?.path || after?.path) === prep.targetPath &&
                Boolean(after?.selection?.rect || after?.hovered?.rect || after?.selected?.rect || after?.rect),
        };
        appendDomPickerLog('loopback_result', { sessionId, selector, result });
        return {
            success: true,
            data: result,
        };
    }
    async handleMessage(socket, raw) {
        let payload;
        try {
            payload = JSON.parse(this.rawToString(raw));
        }
        catch (err) {
            this.send(socket, {
                type: 'error',
                message: `Invalid JSON payload: ${err.message}`,
            });
            return;
        }
        logDebug('browser-service', 'wsMessage', { payload });
        if (payload?.type === 'subscribe') {
            await this.handleSubscribe(socket, payload);
            return;
        }
        if (payload?.type === 'unsubscribe') {
            await this.handleUnsubscribe(socket, payload);
            return;
        }
        if (payload?.type !== 'command') {
            this.send(socket, {
                type: 'error',
                message: 'Unsupported message type',
            });
            return;
        }
        const sessionId = String(payload.session_id || '');
        const requestId = String(payload.request_id || '');
        const command = payload.data || {};
        logDebug('browser-service', 'ws-command', { type: 'command', request_id: requestId, session_id: sessionId, data: command });
        try {
            const data = await this.dispatchCommand(sessionId, command);
            const response = {
                type: 'response',
                request_id: requestId,
                session_id: sessionId,
                data,
            };
            logDebug('browser-service', 'wsResponse', { response });
            this.send(socket, response);
        }
        catch (err) {
            const errorResponse = {
                type: 'response',
                request_id: requestId,
                session_id: sessionId,
                data: {
                    success: false,
                    error: err.message,
                },
            };
            logDebug('browser-service', 'wsError', { errorResponse });
            this.send(socket, errorResponse);
        }
    }
    async dispatchCommand(sessionId, command) {
        const type = command.command_type;
        switch (type) {
            case 'browser_state':
                return this.handleSessionControl(sessionId, {
                    ...command,
                    action: command.action || 'list',
                });
            case 'page_control':
                return this.handlePageControl(sessionId, command);
            case 'dom_operation':
                return this.handleDomOperation(sessionId, command);
            case 'user_action':
                return this.handleUserAction(sessionId, command);
            case 'highlight':
                return this.handleHighlight(sessionId, command);
            case 'session_control':
                return this.handleSessionControl(sessionId, command);
            case 'mode_switch':
                return this.handleModeSwitch(sessionId, command);
            case 'container_operation':
                return this.handleContainerOperation(sessionId, command);
            case 'node_execute':
                return this.handleNodeExecute(sessionId, command);
            case 'dev_control':
                return this.handleDevControl(sessionId, command);
            case 'dev_command':
                return this.handleDevCommand(sessionId, command);
            default:
                throw new Error(`Unknown command_type: ${type}`);
        }
    }
    async handleSubscribe(socket, payload) {
        const requestId = String(payload.request_id || '');
        const sessionId = String(payload.session_id || '');
        const topics = Array.isArray(payload.data?.topics) ? payload.data.topics : [];
        if (!sessionId) {
            this.send(socket, {
                type: 'error',
                request_id: requestId,
                message: 'session_id required for subscribe',
            });
            return;
        }
        const clientTopics = this.subscriptions.get(socket) || new Set();
        const sessionClients = this.sessionSubscribers.get(sessionId) || new Set();
        const requiresRuntimeBridge = topics.some((topic) => topic === 'browser.runtime.event' || topic.startsWith('browser.runtime.event.'));
        topics.forEach((topic) => {
            clientTopics.add(topic);
            sessionClients.add(socket);
        });
        this.subscriptions.set(socket, clientTopics);
        this.sessionSubscribers.set(sessionId, sessionClients);
        if (requiresRuntimeBridge) {
            this.ensureRuntimeEventBridge(sessionId);
        }
        this.send(socket, {
            type: 'response',
            request_id: requestId,
            session_id: sessionId,
            data: { success: true, subscribed: topics },
        });
    }
    async handleUnsubscribe(socket, payload) {
        const requestId = String(payload.request_id || '');
        const sessionId = String(payload.session_id || '');
        const topics = Array.isArray(payload.data?.topics) ? payload.data.topics : [];
        const clientTopics = this.subscriptions.get(socket);
        if (!clientTopics) {
            this.send(socket, {
                type: 'response',
                request_id: requestId,
                session_id: sessionId,
                data: { success: true, unsubscribed: [] },
            });
            return;
        }
        topics.forEach((topic) => clientTopics.delete(topic));
        if (clientTopics.size === 0) {
            this.subscriptions.delete(socket);
        }
        this.send(socket, {
            type: 'response',
            request_id: requestId,
            session_id: sessionId,
            data: { success: true, unsubscribed: topics },
        });
    }
    handleSocketClose(socket) {
        this.subscriptions.delete(socket);
        for (const [sessionId, clients] of this.sessionSubscribers.entries()) {
            clients.delete(socket);
            if (clients.size === 0) {
                this.sessionSubscribers.delete(sessionId);
            }
        }
    }
    broadcastEvent(topic, sessionId, data) {
        const clients = this.sessionSubscribers.get(sessionId);
        if (!clients)
            return;
        const payload = {
            type: 'event',
            topic,
            session_id: sessionId,
            data,
        };
        logDebug('browser-service', 'runtimeEvent:broadcast', { topic, sessionId, listeners: clients.size });
        clients.forEach((socket) => {
            const clientTopics = this.subscriptions.get(socket);
            if (clientTopics?.has(topic)) {
                try {
                    socket.send(JSON.stringify(payload));
                }
                catch (err) {
                    console.warn('[browser-ws] failed to broadcast event:', err);
                }
            }
        });
    }
    ensureRuntimeEventBridge(sessionId) {
        if (this.runtimeBridgeUnsub.has(sessionId))
            return;
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session)
            return;
        const unsub = session.addRuntimeEventObserver((event) => {
            const data = { event, received_at: Date.now() };
            this.broadcastEvent('browser.runtime.event', sessionId, data);
            if (event?.type) {
                this.broadcastEvent(this.formatRuntimeTopic(event.type), sessionId, data);
            }
        });
        this.runtimeBridgeUnsub.set(sessionId, unsub);
    }
    teardownRuntimeEventBridge(sessionId) {
        const unsub = this.runtimeBridgeUnsub.get(sessionId);
        if (unsub) {
            try {
                unsub();
            }
            catch { }
            this.runtimeBridgeUnsub.delete(sessionId);
        }
    }
    formatRuntimeTopic(type) {
        const safe = (type || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '_').toLowerCase();
        return `browser.runtime.event.${safe}`;
    }
    async handlePageControl(sessionId, command) {
        const action = command.action;
        const parameters = command.parameters || {};
        if (!sessionId)
            throw new Error('session_id required');
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return { success: false, error: `Session ${sessionId} not found` };
        }
        if (action === 'navigate') {
            const url = parameters.url;
            if (!url)
                throw new Error('navigate requires url');
            await session.goto(url);
            return { success: true, data: { action: 'navigated', url } };
        }
        if (action === 'screenshot') {
            const filename = parameters.filename || `screenshot_${Date.now()}.png`;
            const fullPage = parameters.full_page !== false;
            const dir = path.resolve(process.cwd(), 'screenshots');
            await fs.promises.mkdir(dir, { recursive: true });
            const target = path.join(dir, filename);
            const buffer = await session.screenshot(fullPage);
            await fs.promises.writeFile(target, buffer);
            return { success: true, data: { action: 'screenshot', screenshot_path: target, full_page: fullPage } };
        }
        throw new Error(`Unknown page_control action: ${action}`);
    }
    async handleDomOperation(sessionId, command) {
        const action = command.action;
        const parameters = command.parameters || {};
        if (action === 'pick_dom') {
            const session = this.options.sessionManager.getSession(sessionId);
            if (!session) {
                return { success: false, error: `Session ${sessionId} not found` };
            }
            return this.handleDomPick(session, parameters);
        }
        if (action === 'query') {
            return this.handleNodeExecute(sessionId, { command_type: 'node_execute', node_type: 'query', parameters });
        }
        if (action === 'dom_full') {
            return this.handleDomFull(sessionId, parameters);
        }
        if (action === 'dom_branch') {
            return this.handleDomBranch(sessionId, parameters);
        }
        throw new Error(`Unknown dom_operation action: ${action}`);
    }
    async handleDomFull(sessionId, parameters) {
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return { success: false, error: 'Session ' + sessionId + ' not found' };
        }
        const page = await session.ensurePage();
        const rootSelector = parameters.root_selector || parameters.rootSelector || null;
        const maxDepth = Number(parameters.max_depth || parameters.maxDepth || 8);
        await ensurePageRuntime(page);
        const domTree = await page.evaluate((config) => {
            const runtime = window.__camoRuntime;
            if (!runtime?.getDomBranch) {
                throw new Error('runtime.getDomBranch unavailable');
            }
            return runtime.getDomBranch('root', {
                rootSelector: config.rootSelector,
                maxDepth: config.maxDepth,
                maxChildren: 100,
            });
        }, { rootSelector, maxDepth });
        const node = domTree.node || {};
        const nodeCount = node.childCount || 0;
        this.broadcastEvent('dom.updated', sessionId, {
            root_path: domTree.path || 'root',
            node_count: nodeCount,
        });
        return {
            success: true,
            data: {
                root_path: domTree.path || 'root',
                node_count: nodeCount,
                snapshot: node,
            },
        };
    }
    async handleDomBranch(sessionId, parameters) {
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return { success: false, error: 'Session ' + sessionId + ' not found' };
        }
        const page = await session.ensurePage();
        const domPath = String(parameters.dom_path || parameters.domPath || '');
        const depth = Number(parameters.depth || 3);
        const rootSelector = parameters.root_selector || parameters.rootSelector || null;
        await ensurePageRuntime(page);
        const snapshot = await page.evaluate((config) => {
            const runtime = window.__camoRuntime;
            if (!runtime?.getDomBranch) {
                throw new Error('runtime.getDomBranch unavailable');
            }
            return runtime.getDomBranch(config.domPath, {
                rootSelector: config.rootSelector,
                maxDepth: config.depth,
                maxChildren: 100,
            });
        }, { domPath, depth, rootSelector });
        const node = snapshot.node || {};
        return {
            success: true,
            data: {
                path: snapshot.path || domPath,
                node_count: node.childCount || 0,
                children: node.children || [],
            },
        };
    }
    async handleUserAction(sessionId, command) {
        const action = command.action;
        const parameters = command.parameters || {};
        if (action !== 'operation') {
            throw new Error(`Unknown user_action action: ${action}`);
        }
        const op = parameters.operation_type;
        if (!op)
            throw new Error('operation_type required');
        if (op === 'click') {
            return legacySelectorActionDisabled('user_action.operation', 'click');
        }
        if (op === 'type') {
            return legacySelectorActionDisabled('user_action.operation', 'type');
        }
        if (op === 'scroll') {
            const session = this.options.sessionManager.getSession(sessionId);
            if (!session) {
                return { success: false, error: `Session ${sessionId} not found` };
            }
            const page = await session.ensurePage();
            const target = parameters.target || {};
            const coordinates = target.coordinates || null;
            const deltaY = Number(parameters.deltaY ?? target.deltaY ?? parameters.delta_y ?? target.delta_y ?? 0);
            await page.mouse.wheel(0, deltaY);
            this.broadcastEvent('user_action.completed', sessionId, {
                action: 'scroll',
                target: coordinates
                    ? `coordinates(${coordinates.x}, ${coordinates.y})`
                    : '',
                duration_ms: 0,
                deltaY,
            });
            return {
                success: true,
                data: {
                    action: 'scroll',
                    deltaY,
                    ...(coordinates ? { x: coordinates.x, y: coordinates.y } : {}),
                },
            };
        }
        if (op === 'move' || op === 'down' || op === 'up' || op === 'key') {
            return this.handleExtendedUserAction(sessionId, op, parameters.target || {}, parameters);
        }
        throw new Error(`Unsupported operation_type: ${op}`);
    }
    async handleExtendedUserAction(sessionId, opType, target, params) {
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return { success: false, error: 'Session ' + sessionId + ' not found' };
        }
        const page = await session.ensurePage();
        const startedAt = Date.now();
        const offset = target.offset || { x: 0, y: 0 };
        const coordinates = target.coordinates || null;
        const domPath = target.dom_path || null;
        const selector = target.selector || null;
        let coords = null;
        // Support direct coordinates
        if (coordinates && typeof coordinates.x === 'number' && typeof coordinates.y === 'number') {
            coords = { x: coordinates.x + offset.x, y: coordinates.y + offset.y };
        }
        else if (domPath) {
            await ensurePageRuntime(page);
            const result = await page.evaluate((config) => {
                const runtime = window.__camoRuntime;
                if (!runtime?.dom?.resolveByPath)
                    return null;
                const el = runtime.dom.resolveByPath(config.path, config.rootSelector);
                if (!el)
                    return null;
                const rect = el.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            }, { path: domPath, rootSelector: null });
            if (result) {
                coords = { x: result.x + offset.x, y: result.y + offset.y };
            }
        }
        else if (selector) {
            const element = await page.$(selector);
            if (element) {
                const box = await element.boundingBox();
                if (box) {
                    coords = { x: box.x + box.width / 2 + offset.x, y: box.y + box.height / 2 + offset.y };
                }
            }
        }
        if (opType === 'move') {
            throw new Error('mouse:move disabled');
        }
        else if (opType === 'down') {
            if (coords) {
                await page.mouse.down();
            }
        }
        else if (opType === 'up') {
            await page.mouse.up();
        }
        else if (opType === 'key') {
            const key = params.key || '';
            if (key) {
                await page.keyboard.press(key);
            }
        }
        const duration = Date.now() - startedAt;
        this.broadcastEvent('user_action.completed', sessionId, {
            action: opType,
            target: domPath || selector || (coordinates ? `coordinates(${coordinates.x}, ${coordinates.y})` : ''),
            duration_ms: duration,
            ...(coords ? { x: coords.x, y: coords.y } : {}),
        });
        return {
            success: true,
            data: {
                action: opType,
                target: domPath || selector || (coordinates ? `coordinates(${coordinates.x}, ${coordinates.y})` : ''),
                duration_ms: duration,
            },
        };
    }
    async handleHighlight(sessionId, command) {
        const action = command.action;
        const parameters = command.parameters || {};
        if (action === 'element') {
            return this.handleDevCommand(sessionId, { command_type: 'dev_command', action: 'highlight_element', parameters });
        }
        if (action === 'dom_path') {
            return this.handleDevCommand(sessionId, { command_type: 'dev_command', action: 'highlight_dom_path', parameters });
        }
        throw new Error(`Unknown highlight action: ${action}`);
    }
    async handleSessionControl(sessionId, command) {
        const action = command.action;
        if (action === 'create') {
            const capabilities = command.capabilities || ['dom'];
            const browserConfig = command.browser_config || {};
            const profileId = browserConfig.profile_id || browserConfig.session_name || `session_${Date.now().toString(36)}`;
            const headless = browserConfig.headless ?? false;
            const viewport = browserConfig.viewport;
            const userAgent = browserConfig.user_agent;
            const initialUrl = browserConfig.initial_url || command.initial_url;
            const result = await this.options.sessionManager.createSession({
                profileId,
                sessionName: browserConfig.session_name || profileId,
                headless,
                viewport,
                userAgent,
                initialUrl,
            });
            this.capabilityMap.set(result.sessionId, capabilities);
            return {
                success: true,
                session_id: result.sessionId,
                status: 'ready',
                capabilities,
            };
        }
        if (action === 'list') {
            const sessions = this.options.sessionManager.listSessions().map((session) => ({
                session_id: session.session_id || session.profileId,
                profileId: session.profileId,
                current_url: session.current_url,
                mode: session.mode,
                status: 'ready',
                capabilities: this.capabilityMap.get(session.profileId) || [],
            }));
            return {
                success: true,
                sessions,
            };
        }
        if (action === 'info') {
            if (!sessionId) {
                throw new Error('session_id required for info action');
            }
            const info = await this.options.sessionManager.getSessionInfo(sessionId);
            if (!info) {
                return {
                    success: false,
                    error: `Session ${sessionId} not found`,
                };
            }
            return {
                success: true,
                session_info: {
                    ...info,
                    capabilities: this.capabilityMap.get(sessionId) || [],
                },
            };
        }
        if (action === 'delete') {
            if (!sessionId) {
                throw new Error('session_id required for delete action');
            }
            const deleted = await this.options.sessionManager.deleteSession(sessionId);
            this.capabilityMap.delete(sessionId);
            return {
                success: deleted,
                session_id: sessionId,
            };
        }
        throw new Error(`Unknown session action: ${action}`);
    }
    async handleModeSwitch(sessionId, command) {
        if (!sessionId) {
            throw new Error('session_id required for mode switch');
        }
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return {
                success: false,
                error: `Session ${sessionId} not found`,
            };
        }
        const target = command.target_mode || 'dev';
        session.setMode(target);
        return {
            success: true,
            session_id: sessionId,
            new_mode: target,
        };
    }
    async handleContainerOperation(sessionId, command) {
        if (!sessionId) {
            throw new Error('session_id required for container operations');
        }
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return {
                success: false,
                error: `Session ${sessionId} not found`,
            };
        }
        logDebug('browser-service', 'containerOperation', { sessionId, command });
        const pageContext = command.page_context || {};
        if (command.action === 'match_root') {
            const match = await this.matcher.matchRoot(session, pageContext);
            if (!match) {
                return {
                    success: false,
                    error: 'No matching container found',
                };
            }
            return {
                success: true,
                data: {
                    container: match.container,
                    selector: match.container?.matched_selector || match.match_details?.selector,
                    domPath: match.match_details?.dom_path || null,
                    match_details: match.match_details,
                },
            };
        }
        if (command.action === 'inspect_tree') {
            const snapshot = await this.matcher.inspectTree(session, pageContext, command.parameters || {});
            return {
                success: true,
                data: snapshot,
            };
        }
        if (command.action === 'inspect_dom_branch') {
            const branch = await this.matcher.inspectDomBranch(session, pageContext, command.parameters || {});
            return {
                success: true,
                data: branch,
            };
        }
        throw new Error(`Unsupported container action: ${command.action}`);
    }
    async handleNodeExecute(sessionId, command) {
        if (!sessionId) {
            throw new Error('session_id required for node_execute');
        }
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return {
                success: false,
                error: `Session ${sessionId} not found`,
            };
        }
        const nodeType = command.node_type;
        const parameters = command.parameters || {};
        switch (nodeType) {
            case 'navigate': {
                const url = parameters.url;
                if (!url) {
                    throw new Error('Navigate node requires url');
                }
                await session.goto(url);
                return {
                    success: true,
                    data: {
                        action: 'navigated',
                        url,
                    },
                };
            }
            case 'click': {
                return legacySelectorActionDisabled('node_execute', 'click');
            }
            case 'type': {
                return legacySelectorActionDisabled('node_execute', 'type');
            }
            case 'screenshot': {
                const filename = parameters.filename || `screenshot_${Date.now()}.png`;
                const fullPage = parameters.full_page !== false;
                const dir = path.resolve(process.cwd(), 'screenshots');
                await fs.promises.mkdir(dir, { recursive: true });
                const target = path.join(dir, filename);
                const buffer = await session.screenshot(fullPage);
                await fs.promises.writeFile(target, buffer);
                return {
                    success: true,
                    data: {
                        action: 'screenshot',
                        screenshot_path: target,
                        full_page: fullPage,
                    },
                };
            }
            case 'query': {
                const selector = parameters.selector;
                if (!selector)
                    throw new Error('Query node requires selector');
                const limit = Number(parameters.max_items || parameters.maxItems || 5);
                const page = await session.ensurePage();
                const result = await page.$$eval(selector, (els, lim) => {
                    const sample = [];
                    const max = Math.max(0, Number(lim) || 0);
                    for (let i = 0; i < Math.min(max, els.length); i++) {
                        const el = els[i];
                        sample.push({
                            tag: el.tagName,
                            id: el.id || null,
                            classes: Array.from(el.classList || []),
                            text: (el.textContent || '').trim().slice(0, 120),
                        });
                    }
                    return {
                        count: els.length,
                        sample,
                    };
                }, limit);
                return {
                    success: true,
                    data: {
                        selector,
                        count: result.count,
                        sample: result.sample,
                    },
                };
            }
            case 'dom_info': {
                const page = await session.ensurePage();
                const info = await page.evaluate(() => {
                    const doc = document;
                    const html = doc.documentElement;
                    const body = doc.body;
                    const serialize = (el) => {
                        if (!el)
                            return null;
                        return {
                            tag: el.tagName,
                            id: el.id || null,
                            classes: Array.from(el.classList || []),
                        };
                    };
                    const firstChildren = (el, limit = 8) => {
                        if (!el || !el.children)
                            return [];
                        return Array.from(el.children)
                            .slice(0, limit)
                            .map((child) => serialize(child));
                    };
                    return {
                        html: serialize(html),
                        body: serialize(body),
                        app: serialize(doc.getElementById('app')),
                        appChildren: firstChildren(doc.getElementById('app')),
                        bodyChildren: firstChildren(body),
                    };
                });
                return {
                    success: true,
                    data: info,
                };
            }
            case 'eval':
            case 'evaluate':
            case 'evaluate_js': {
                const expression = parameters.expression || parameters.script;
                if (!expression) {
                    throw new Error('Eval node requires expression');
                }
                const arg = parameters.arg;
                const result = await session.evaluate(expression, arg);
                return {
                    success: true,
                    data: { result },
                };
            }
            case 'pick_dom': {
                const result = await this.handleDomPick(session, parameters);
                return {
                    success: true,
                    data: result,
                };
            }
            case 'dom_pick_loopback': {
                const result = await this.handleDomPickerLoopback(session, parameters);
                return {
                    success: true,
                    data: result,
                };
            }
            default:
                throw new Error(`Unsupported node type: ${nodeType}`);
        }
    }
    async handleDevControl(sessionId, command) {
        if (command.action === 'enable_overlay') {
            return {
                success: true,
                data: {
                    enabled: true,
                    message: 'Overlay not implemented in TS service yet',
                },
            };
        }
        return {
            success: false,
            error: `Unsupported dev control action: ${command.action}`,
        };
    }
    async handleDevCommand(sessionId, command) {
        if (!sessionId) {
            throw new Error('session_id required for dev_command');
        }
        const session = this.options.sessionManager.getSession(sessionId);
        if (!session) {
            return {
                success: false,
                error: `Session ${sessionId} not found`,
            };
        }
        const action = command.action;
        const parameters = command.parameters || {};
        switch (action) {
            case 'highlight_element': {
                const selector = (parameters.selector || '').trim();
                if (!selector) {
                    return { success: false, error: 'selector required' };
                }
                const channel = (parameters.channel || 'ui-action').trim() || 'ui-action';
                const style = typeof parameters.style === 'string' ? parameters.style : undefined;
                const duration = typeof parameters.duration === 'number' ? parameters.duration : Number(parameters.duration || 0);
                const sticky = typeof parameters.sticky === 'boolean' ? parameters.sticky : Boolean(parameters.hold || false);
                const rootSelector = parameters.root_selector || parameters.rootSelector || null;
                appendHighlightLog('request', { sessionId, channel, selector, style, duration, sticky, rootSelector });
                const page = await session.ensurePage();
                const result = await page.evaluate((config) => {
                    if (!window.__camoRuntime?.highlight?.highlightSelector) {
                        throw new Error('highlight runtime unavailable');
                    }
                    const res = window.__camoRuntime.highlight.highlightSelector(config.selector, {
                        channel: config.channel,
                        ...(config.style ? { style: config.style } : {}),
                        ...(Number.isFinite(config.duration) && config.duration > 0 ? { duration: config.duration } : {}),
                        ...(typeof config.sticky === 'boolean' ? { sticky: config.sticky } : {}),
                        ...(config.rootSelector ? { rootSelector: config.rootSelector } : {}),
                    });
                    const count = typeof res === 'number' ? res : Number(res?.count || res?.matched || 0);
                    return { count: Number.isFinite(count) ? count : 0, channel: config.channel };
                }, { selector, channel, style, duration: Number.isFinite(duration) ? duration : 0, sticky, rootSelector });
                appendHighlightLog('result', { sessionId, channel, selector, count: result?.count || 0 });
                return { success: true, data: result };
            }
            case 'clear_highlight': {
                const channel = (parameters.channel || 'ui-action').trim() || 'ui-action';
                appendHighlightLog('clear', { sessionId, channel });
                const page = await session.ensurePage();
                await page.evaluate((ch) => {
                    window.__camoRuntime?.highlight?.clear?.(ch);
                }, channel);
                return {
                    success: true,
                    data: { cleared: true },
                };
            }
            case 'highlight_dom_path': {
                const path = (parameters.path || parameters.dom_path || '').trim();
                if (!path) {
                    return { success: false, error: 'path required' };
                }
                const channel = (parameters.channel || 'ui-action').trim() || 'ui-action';
                const style = typeof parameters.style === 'string' ? parameters.style : undefined;
                const duration = typeof parameters.duration === 'number' ? parameters.duration : Number(parameters.duration || 0);
                const sticky = typeof parameters.sticky === 'boolean' ? parameters.sticky : Boolean(parameters.hold || false);
                const rootSelector = parameters.root_selector || parameters.rootSelector || null;
                appendHighlightLog('request', { sessionId, channel, path, style, duration, sticky, rootSelector });
                const page = await session.ensurePage();
                const result = await page.evaluate((config) => {
                    const runtime = window.__camoRuntime;
                    if (!runtime?.highlight?.highlightElements) {
                        throw new Error('highlight runtime unavailable');
                    }
                    if (!runtime?.dom?.resolveByPath) {
                        throw new Error('dom resolveByPath unavailable');
                    }
                    const node = runtime.dom.resolveByPath(config.path, config.rootSelector || null);
                    if (!node)
                        return { count: 0, channel: config.channel };
                    runtime.highlight.highlightElements([node], {
                        channel: config.channel,
                        ...(config.style ? { style: config.style } : {}),
                        ...(Number.isFinite(config.duration) && config.duration > 0 ? { duration: config.duration } : {}),
                        ...(typeof config.sticky === 'boolean' ? { sticky: config.sticky } : {}),
                        ...(config.rootSelector ? { rootSelector: config.rootSelector } : {}),
                    });
                    return { count: 1, channel: config.channel };
                }, { path, channel, style, duration: Number.isFinite(duration) ? duration : 0, sticky, rootSelector });
                appendHighlightLog('result', { sessionId, channel, path, count: result?.count || 0 });
                return { success: true, data: result };
            }
            case 'cancel_dom_pick': {
                const result = await this.cancelDomPicker(session);
                return {
                    success: true,
                    data: result,
                };
            }
            default:
                return {
                    success: false,
                    error: `Unsupported dev command: ${action}`,
                };
        }
    }
    async highlightViaRuntime() {
        return { count: 0 };
    }
    async clearHighlightOverlays() {
        return { cleared: 0 };
    }
    async cancelDomPicker(session) {
        const page = await session.ensurePage();
        return page.evaluate(() => {
            const cancel = window.__camoDomPickerCancel;
            if (typeof cancel === 'function') {
                try {
                    cancel();
                    window.__camoDomPickerCancel = null;
                    return { cancelled: true };
                }
                catch (err) {
                    return { cancelled: false, error: err.message };
                }
            }
            return { cancelled: false };
        });
    }
    send(socket, payload) {
        try {
            socket.send(JSON.stringify(payload));
        }
        catch (err) {
            console.error('[browser-ws] failed to send message:', err);
        }
    }
    rawToString(data) {
        if (typeof data === 'string')
            return data;
        if (Buffer.isBuffer(data))
            return data.toString('utf-8');
        if (Array.isArray(data)) {
            return Buffer.concat(data).toString('utf-8');
        }
        return Buffer.from(data).toString('utf-8');
    }
}
//# sourceMappingURL=ws-server.js.map
