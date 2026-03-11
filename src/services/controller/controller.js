import path from 'node:path';
import os from 'node:os';
import { loadContainerIndex } from './container-index.js';
import { createContainerActionHandlers } from './controller-actions.js';
import { createTransport } from './transport.js';
import { createCliBridge } from './cli-bridge.js';

function normalizeInputMode(mode) {
  const raw = String(mode || '').trim().toLowerCase();
  return raw === 'protocol' ? 'protocol' : 'system';
}

export class UiController {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || process.cwd();
    this.messageBus = options.messageBus;
    // 外置容器树：统一使用 ~/.camo/container-lib
    this.userContainerRoot =
      options.userContainerRoot || path.join(os.homedir(), '.camo', 'container-lib');
    this.containerIndexPath = options.containerIndexPath || process.env.CAMO_CONTAINER_INDEX || '';
    this.cliTargets = options.cliTargets || {};
    this.defaultWsHost = options.defaultWsHost || '127.0.0.1';
    this.defaultWsPort = Number(options.defaultWsPort || 8765);
    this.defaultHttpHost = options.defaultHttpHost || '127.0.0.1';
    this.defaultHttpPort = Number(options.defaultHttpPort || 7704);
    this.defaultHttpProtocol = options.defaultHttpProtocol || 'http';
    this.inputMode = normalizeInputMode(process.env.CAMO_INPUT_MODE);
    this.errorHandler = null;
    this.containerIndex = null;
    this.containerActions = this.buildContainerActions();
    this.transport = createTransport({
      env: process.env,
      defaults: {
        wsHost: this.defaultWsHost,
        wsPort: this.defaultWsPort,
        httpHost: this.defaultHttpHost,
        httpPort: this.defaultHttpPort,
        httpProtocol: this.defaultHttpProtocol,
      },
      debugLog: (label, data) => this.debugLog(label, data),
    });
    this.cliBridge = createCliBridge({
      cliTargets: this.cliTargets,
      repoRoot: this.repoRoot,
      env: process.env,
      logger: {
        info: (label, data) => this.debugLog(label, data),
        warn: (label, data) => this.debugLog(label, data),
      },
    });
  }

  buildContainerActions() {
    return createContainerActionHandlers({
      userContainerRoot: this.userContainerRoot,
      errorHandler: this.errorHandler,
      getContainerIndex: () => this.getContainerIndex(),
      fetchInspectorSnapshot: (opts) => this.captureInspectorSnapshot(opts),
      fetchInspectorBranch: (opts) => this.captureInspectorBranch(opts),
      fetchContainerMatch: (payload) => this.handleContainerMatchCore(payload),
    });
  }

  getContainerIndex() {
    if (!this.containerIndexPath) {
      throw new Error('CAMO_CONTAINER_INDEX is required for container actions.');
    }
    if (!this.containerIndex) {
      this.containerIndex = loadContainerIndex(this.containerIndexPath, this.errorHandler);
    }
    return this.containerIndex || {};
  }

  debugLog(label, data) {
    if (process.env.DEBUG !== '1' && process.env.CAMO_DEBUG !== '1') return;
    try {
      const safe = JSON.stringify(data);
      // Keep logs single-line JSON for grepability.
      console.log(`[ui-controller:${label}] ${safe}`);
    } catch {
      console.log(`[ui-controller:${label}]`, data);
    }
  }

  async handleAction(action, payload = {}) {
    const startedAt = Date.now();
    const profileId = (payload.profileId || payload.profile || payload.sessionId || '').toString();
    this.debugLog('action:start', { action, profileId });
    switch (action) {
      case 'browser:status':
        return this.fetchBrowserStatus();
      case 'session:list':
        return this.runCliCommand('session-manager', ['list']);
      case 'session:create':
        return this.handleSessionCreate(payload);
      case 'session:delete':
        return this.handleSessionDelete(payload);
      case 'logs:stream':
        return this.handleLogsStream(payload);
      case 'operations:list':
        return this.runCliCommand('operations', ['list']);
      case 'operations:run':
        return this.handleOperationRun(payload);
     case 'containers:inspect':
       return this.handleContainerInspect(payload);
     case 'containers:inspect-container':
       return this.handleContainerInspectContainer(payload);
     case 'containers:inspect-branch':
       return this.handleContainerInspectBranch(payload);
     case 'containers:remap':
       return this.handleContainerRemap(payload);
     case 'containers:create-child':
       return this.handleContainerCreateChild(payload);
     case 'containers:update-alias':
       return this.handleContainerUpdateAlias(payload);
    case 'containers:update-operations':
      return this.handleContainerUpdateOperations(payload);
    case 'browser:highlight':
      return this.handleBrowserHighlight(payload);
    case 'browser:clear-highlight':
      return this.handleBrowserClearHighlight(payload);
    case 'browser:execute':
      return this.handleBrowserExecute(payload);
    case 'browser:screenshot':
      return this.handleBrowserScreenshot(payload);
    case 'browser:page:list':
      return this.handleBrowserPageList(payload);
    case 'browser:page:new':
      return this.handleBrowserPageNew(payload);
    case 'browser:page:switch':
      return this.handleBrowserPageSwitch(payload);
    case 'browser:page:close':
      return this.handleBrowserPageClose(payload);
    case 'browser:goto':
      return this.handleBrowserGoto(payload);
     case 'browser:highlight-dom-path':
       return this.handleBrowserHighlightDomPath(payload);
     case 'browser:cancel-pick':
       return this.handleBrowserCancelDomPick(payload);
     case 'browser:pick-dom':
       return this.handleBrowserPickDom(payload);
     case 'keyboard:press':
       return this.handleKeyboardPress(payload);
     case 'keyboard:type':
        return this.handleKeyboardType(payload);
      case 'system:shortcut':
        return this.handleSystemShortcut(payload);
      case 'system:input-mode:set':
        return this.handleSystemInputModeSet(payload);
      case 'system:input-mode:get':
        return this.handleSystemInputModeGet();
    case 'mouse:wheel':
      return this.handleMouseWheel(payload);
    case 'mouse:click':
      return this.handleMouseClick(payload);
     case 'dom:branch:2':
       return this.handleDomBranch2(payload);
     case 'dom:pick:2':
       return this.handleDomPick2(payload);
     case 'browser:inspect_tree':
       return this.fetchInspectTree(payload);
     case 'containers:match':
       return this.handleContainerMatch(payload);
     case 'container:operation':
       return this.handleContainerOperation(payload);
     default:
       return { success: false, error: `Unknown action: ${action}` };
   }
  }

  async runWithTrace(label, fn) {
    const startedAt = Date.now();
    try {
      const res = await fn();
      this.debugLog(`${label}:ok`, { ms: Date.now() - startedAt });
      return res;
    } catch (err) {
      this.debugLog(`${label}:err`, { ms: Date.now() - startedAt, error: err?.message || String(err) });
      throw err;
    }
  }

  async fetchBrowserStatus() {
    try {
      const url = `${this.getBrowserHttpBase()}/health`;
      const res = await fetch(url);
      if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
      return { success: true, data: await res.json() };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async fetchInspectTree(payload) {
    try {
      const wsUrl = this.getBrowserWsUrl();
      const command = {
        type: 'command',
        session_id: payload?.profile || 'default',
        data: {
          command_type: 'container_operation',
          action: 'inspect_tree',
          page_context: { url: payload?.url || 'https://example.com' },
          parameters: {
            ...(payload?.rootSelector ? { root_selector: payload.rootSelector } : {}),
            ...(typeof payload?.maxDepth === 'number' ? { max_depth: payload.maxDepth } : {}),
            ...(typeof payload?.maxChildren === 'number' ? { max_children: payload.maxChildren } : {}),
          },
        },
      };
      const wsResult = await this.sendWsCommand(wsUrl, command, 15000);
      if (wsResult?.data?.success !== true) {
        return { success: false, error: wsResult?.data?.error || 'inspect_tree failed' };
      }
      return { success: true, data: wsResult.data.data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async handleSessionCreate(payload = {}) {
    if (!payload.profile) {
      throw new Error('缺少 profile');
    }
    const args = ['create', '--profile', payload.profile];
    if (payload.url) args.push('--url', payload.url);
    if (payload.headless === false) args.push('--no-headless');
    if (payload.keepOpen !== undefined) args.push('--keep-open', String(payload.keepOpen));
    return this.runCliCommand('session-manager', args);
  }

  async handleSessionDelete(payload = {}) {
    if (!payload.profile) {
      throw new Error('缺少 profile');
    }
    return this.runCliCommand('session-manager', ['delete', '--profile', payload.profile]);
  }

  async handleLogsStream(payload = {}) {
    const args = ['stream'];
    if (payload.source) args.push('--source', payload.source);
    if (payload.session) args.push('--session', payload.session);
    if (payload.lines) args.push('--lines', String(payload.lines));
    return this.runCliCommand('logging', args);
  }

  async handleOperationRun(payload = {}) {
    const op = payload.op || payload.operation || payload.id;
    if (!op) throw new Error('缺少操作 ID');
    const args = ['run', '--op', op];
    if (payload.config) {
      args.push('--config', JSON.stringify(payload.config));
    }
    return this.runCliCommand('operations', args);
  }

  async handleContainerInspect(payload = {}) {
    return this.containerActions.handleContainerInspect(payload);
  }

  async handleContainerInspectContainer(payload = {}) {
    return this.containerActions.handleContainerInspectContainer(payload);
  }

  async handleContainerInspectBranch(payload = {}) {
    return this.containerActions.handleContainerInspectBranch(payload);
  }

  async handleContainerRemap(payload = {}) {
    return this.containerActions.handleContainerRemap(payload);
  }

  async handleContainerCreateChild(payload = {}) {
    return this.containerActions.handleContainerCreateChild(payload);
  }

  async handleContainerUpdateAlias(payload = {}) {
    return this.containerActions.handleContainerUpdateAlias(payload);
  }

  async handleContainerUpdateOperations(payload = {}) {
    return this.containerActions.handleContainerUpdateOperations(payload);
  }

  async handleContainerMatch(payload = {}) {
    return this.containerActions.handleContainerMatch(payload);
  }

  async handleContainerMatchCore(payload = {}) {
    const profile = payload.profileId || payload.profile;
    const url = payload.url;
    if (!profile) throw new Error('缺少 profile');
    if (!url) throw new Error('缺少 URL');
    try {
      const context = await this.captureInspectorSnapshot({
        profile,
        url,
        maxDepth: payload.maxDepth || 2,
        maxChildren: payload.maxChildren || 5,
        rootSelector: payload.rootSelector,
      });
      const snapshot = context.snapshot;
      const rootContainer = snapshot?.root_match?.container || snapshot?.container_tree?.container || snapshot?.container_tree?.containers?.[0];
      const matchPayload = {
        sessionId: context.sessionId,
        profileId: context.profileId,
        url: context.targetUrl,
        matched: !!rootContainer,
        container: rootContainer || null,
        snapshot,
      };
      this.messageBus?.publish?.('containers.matched', matchPayload);
      this.messageBus?.publish?.('handshake.status', {
        status: matchPayload.matched ? 'ready' : 'pending',
        profileId: matchPayload.profileId,
        sessionId: matchPayload.sessionId,
        url: matchPayload.url,
        matched: matchPayload.matched,
        containerId: matchPayload.container?.id || null,
        source: 'containers:match',
        ts: Date.now(),
      });
      return { success: true, data: matchPayload };
    } catch (err) {
      throw new Error(`容器匹配失败: ${err?.message || String(err)}`);
    }
  }

  async handleContainerOperation(payload = {}) {
    const containerId = payload.containerId || payload.id;
    const operationId = payload.operationId;
    const sessionId =
      payload.profile ||
      payload.profileId ||
      payload.profile_id ||
      payload.sessionId ||
      payload.session_id;

    if (!containerId) {
      return { success: false, error: 'Missing containerId' };
    }
    if (!operationId) {
      return { success: false, error: 'Missing operationId' };
    }
    if (!sessionId) {
      return { success: false, error: 'Missing sessionId/profile' };
    }

    const port = process.env.CAMO_UNIFIED_PORT || 7701;
    const host = '127.0.0.1';

    try {
      const mergedConfig = { ...(payload.config || {}) };
      if (['click', 'type', 'key', 'scroll'].includes(String(operationId))) {
        if (this.inputMode === 'protocol') {
          mergedConfig.useSystemMouse = false;
        } else if (typeof mergedConfig.useSystemMouse !== 'boolean') {
          mergedConfig.useSystemMouse = true;
        }
      }

      const response = await fetch(`http://${host}:${port}/v1/container/${containerId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId,
          config: mergedConfig,
          sessionId,
        }),
      });
      if (!response.ok) {
        return { success: false, error: await response.text() };
      }
      return await response.json();
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  }

      async handleBrowserHighlight(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    const selector = (payload.selector || '').trim();
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    if (!selector) {
      throw new Error('缺少 selector');
    }
    const options = payload.options || {};
    
    // 处理颜色
    let style = options.style;
    const color = payload.color;
    if (!style) {
        if (color === 'green') style = '2px solid rgba(76, 175, 80, 0.95)';
        else if (color === 'blue') style = '2px solid rgba(33, 150, 243, 0.95)';
        else if (color === 'red') style = '2px solid rgba(244, 67, 54, 0.95)';
        else if (color && /^[a-z]+$/i.test(color)) style = `2px solid ${color}`;
        else style = '2px solid rgba(255, 0, 0, 0.8)';
    }

    const highlightOpts = {
      style,
      duration: options.duration,
      channel: options.channel || payload.channel,
      sticky: options.sticky,
      maxMatches: options.maxMatches,
    };
    try {
      const result = await this.sendHighlightViaWs(profile, selector, highlightOpts);
      this.messageBus?.publish?.('ui.highlight.result', {
        success: true,
        selector,
        source: result?.source || 'unknown',
        details: result?.details || null,
      });
      return { success: true, data: result };
    } catch (err) {
      const errorMessage = err?.message || '高亮请求失败';
      this.messageBus?.publish?.('ui.highlight.result', {
        success: false,
        selector,
        error: errorMessage,
      });
      return { success: false, error: errorMessage };
    }
  }


  async handleBrowserClearHighlight(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    try {
      const result = await this.sendClearHighlightViaWs(profile, payload.channel || payload.options?.channel || null);
      this.messageBus?.publish?.('ui.highlight.result', {
        success: true,
        selector: null,
        details: result,
      });
      return { success: true, data: result };
    } catch (err) {
      const message = err?.message || '清除高亮失败';
      this.messageBus?.publish?.('ui.highlight.result', {
        success: false,
        selector: null,
        error: message,
      });
      throw err;
    }
  }

  async handleBrowserHighlightDomPath(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    const domPath = (payload.path || payload.domPath || payload.dom_path || '').trim();
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    if (!domPath) {
      throw new Error('缺少 DOM 路径');
    }
    const options = payload.options || {};
    const channel = options.channel || payload.channel || 'hover-dom';
    const rootSelector = options.rootSelector || payload.rootSelector || payload.root_selector || null;

    let style = options.style;
    if (!style && payload.color) {
      const color = payload.color;
      if (color === 'green') style = '2px solid rgba(76, 175, 80, 0.95)';
      else if (color === 'blue') style = '2px solid rgba(33, 150, 243, 0.95)';
      else if (color === 'red') style = '2px solid rgba(244, 67, 54, 0.95)';
      else if (color && /^[a-z]+$/i.test(color)) style = `2px solid ${color}`;
    }
    if (!style) {
      style = '2px solid rgba(96, 165, 250, 0.95)';
    }

    const sticky = typeof options.sticky === 'boolean' ? options.sticky : true;
    try {
      const result = await this.sendHighlightDomPathViaWs(profile, domPath, {
        channel,
        style,
        sticky,
        duration: options.duration,
        rootSelector,
      });
      this.messageBus?.publish?.('ui.highlight.result', {
        success: true,
        selector: null,
        details: result?.details || null,
      });
      return { success: true, data: result };
    } catch (err) {
      const errorMessage = err?.message || 'DOM 路径高亮失败';
      this.messageBus?.publish?.('ui.highlight.result', {
        success: false,
        selector: null,
        error: errorMessage,
      });
      throw err;
    }
  }

  async handleBrowserExecute(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    const script = payload.script || payload.code || '';
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    if (!script) {
      throw new Error('缺少 script 参数');
    }
    try {
      const result = await this.sendExecuteViaWs(profile, script);
      return { success: true, data: result };
    } catch (err) {
      const errorMessage = err?.message || '执行脚本失败';
      throw new Error(errorMessage);
    }
  }

  async handleBrowserScreenshot(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const fullPage = typeof payload.fullPage === 'boolean' ? payload.fullPage : Boolean(payload.fullPage);
    const result = await this.browserServiceCommand('screenshot', { profileId, fullPage }, { timeoutMs: 60000 });
    return { success: true, data: result };
  }

  async handleBrowserPageList(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const result = await this.browserServiceCommand('page:list', { profileId }, { timeoutMs: 30000 });
    return { success: true, data: result };
  }

  async handleBrowserPageNew(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const url = payload.url ? String(payload.url) : undefined;
    const result = await this.browserServiceCommand('page:new', { profileId, ...(url ? { url } : {}) }, { timeoutMs: 30000 });
    const index = Number(result?.index ?? result?.data?.index);
    if (Number.isFinite(index)) {
      return { success: true, data: result };
    }
    const list = await this.browserServiceCommand('page:list', { profileId }, { timeoutMs: 30000 });
    const activeIndexRaw = list?.activeIndex ?? list?.data?.activeIndex;
    const activeIndex = Number(activeIndexRaw);
    if (Number.isFinite(activeIndex)) {
      return { success: true, data: { ...(result || {}), index: activeIndex, fallback: 'activeIndex' } };
    }
    return { success: true, data: result };
  }

  async handleBrowserPageSwitch(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const index = Number(payload.index);
    if (!Number.isFinite(index)) throw new Error('index required');
    const result = await this.browserServiceCommand('page:switch', { profileId, index }, { timeoutMs: 30000 });
    return { success: true, data: result };
  }

  async handleBrowserPageClose(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const hasIndex = typeof payload.index !== 'undefined' && payload.index !== null;
    const index = hasIndex ? Number(payload.index) : undefined;
    const result = await this.browserServiceCommand(
      'page:close',
      { profileId, ...(Number.isFinite(index) ? { index } : {}) },
      { timeoutMs: 30000 },
    );
    return { success: true, data: result };
  }

  async handleBrowserGoto(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const url = (payload.url || '').toString();
    if (!url) throw new Error('url required');
    const result = await this.browserServiceCommand('goto', { profileId, url });
    return { success: true, data: result };
  }

  async handleKeyboardPress(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const key = (payload.key || 'Enter').toString();
    const delay = typeof payload.delay === 'number' ? payload.delay : undefined;
    const result = await this.browserServiceCommand('keyboard:press', { profileId, key, ...(delay ? { delay } : {}) });
    return { success: true, data: result };
  }

  async handleKeyboardType(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const text = (payload.text ?? '').toString();
    const delay = typeof payload.delay === 'number' ? payload.delay : undefined;
    const submit = typeof payload.submit === 'boolean' ? payload.submit : Boolean(payload.submit);
    const result = await this.browserServiceCommand(
      'keyboard:type',
      { profileId, text, ...(delay ? { delay } : {}), ...(submit ? { submit } : {}) },
    );
    return { success: true, data: result };
  }
  async handleSystemShortcut(payload = {}) {
    const shortcut = String(payload.shortcut || '').trim();
    const app = String(payload.app || 'camoufox').trim();
    if (!shortcut) throw new Error('shortcut required');

    if (process.platform === 'darwin') {
      const { spawnSync } = await import('node:child_process');
      spawnSync('osascript', ['-e', `tell application "${app}" to activate`]);
      if (shortcut === 'new-tab') {
        const res = spawnSync('osascript', [
          '-e',
          'tell application "System Events" to keystroke "t" using command down'
        ]);
        if (res.status != 0) throw new Error('osascript new-tab failed');
        return { success: true, data: { ok: true, shortcut } };
      }
      throw new Error(`unsupported shortcut: ${shortcut}`);
    }

    if (process.platform === 'win32') {
      const { spawnSync } = await import('node:child_process');
      if (shortcut === 'new-tab') {
        const script =
          'Add-Type -AssemblyName System.Windows.Forms; $ws = New-Object -ComObject WScript.Shell; $ws.SendKeys("^t");';
        const res = spawnSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
        if (res.status != 0) throw new Error('powershell new-tab failed');
        return { success: true, data: { ok: true, shortcut } };
      }
      throw new Error(`unsupported shortcut: ${shortcut}`);
    }

    throw new Error('unsupported platform');
  }

  async handleSystemInputModeSet(payload = {}) {
    const mode = normalizeInputMode(payload.mode);
    this.inputMode = mode;
    process.env.CAMO_INPUT_MODE = mode;
    return { success: true, data: { mode } };
  }

  async handleSystemInputModeGet() {
    return { success: true, data: { mode: this.inputMode } };
  }


  async handleMouseWheel(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const deltaY = Number(payload.deltaY);
    const deltaX = Number(payload.deltaX);
    const result = await this.browserServiceCommand('mouse:wheel', { profileId, deltaY, deltaX });
    return { success: true, data: result };
  }

  async handleMouseClick(payload = {}) {
    const profileId = (payload.profileId || payload.profile || payload.sessionId || 'default').toString();
    const x = Number(payload.x);
    const y = Number(payload.y);
    const button = payload.button || 'left';
    const clicks = typeof payload.clicks === 'number' ? payload.clicks : 1;
    const delay = typeof payload.delay === 'number' ? payload.delay : undefined;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('x/y required for mouse:click');
    }
    const result = await this.browserServiceCommand('mouse:click', { profileId, x, y, button, clicks, ...(delay ? { delay } : {}) });
    return { success: true, data: result };
  }

  async handleBrowserCancelDomPick(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    try {
      const data = await this.sendCancelDomPickViaWs(profile);
      this.messageBus?.publish?.('ui.domPicker.result', {
        success: false,
        cancelled: true,
        source: 'cancel-action',
        details: data,
      });
      return { success: true, data };
    } catch (err) {
      const message = err?.message || '取消捕获失败';
      this.messageBus?.publish?.('ui.domPicker.result', {
        success: false,
        cancelled: true,
        error: message,
      });
      throw err;
    }
  }

  async handleBrowserPickDom(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    const timeout = Math.min(Math.max(Number(payload.timeout) || 25000, 3000), 60000);
    const rootSelector = payload.rootSelector || payload.root_selector || null;
    const startedAt = Date.now();
    try {
      const result = await this.sendDomPickerViaWs(profile, {
        timeout,
        rootSelector,
      });
      this.messageBus?.publish?.('ui.domPicker.result', {
        success: true,
        selector: result?.selector || null,
        domPath: result?.dom_path || null,
        durationMs: Date.now() - startedAt,
      });
      return { success: true, data: result };
    } catch (err) {
      const message = err?.message || '元素拾取失败';
      this.messageBus?.publish?.('ui.domPicker.result', { success: false, error: message });
      throw err;
    }
  }

  // v2 DOM pick：直接暴露 dom_path + selector 给 UI
  async handleDomPick2(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    if (!profile) {
      throw new Error('缺少会话/ profile 信息');
    }
    const timeout = Math.min(Math.max(Number(payload.timeout) || 25000, 3000), 60000);
    const rootSelector = payload.rootSelector || payload.root_selector || null;
    const result = await this.sendDomPickerViaWs(profile, { timeout, rootSelector });
    // 统一输出结构：domPath + selector
    return {
      success: true,
      data: {
        domPath: result?.dom_path || null,
        selector: result?.selector || null,
        raw: result,
      },
    };
  }

  async sendHighlightViaWs(sessionId, selector, options = {}) {
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'dev_command',
        action: 'highlight_element',
        parameters: {
          selector,
          ...(options.style ? { style: options.style } : {}),
          ...(typeof options.duration === 'number' ? { duration: options.duration } : {}),
          ...(options.channel ? { channel: options.channel } : {}),
          ...(typeof options.sticky === 'boolean' ? { sticky: options.sticky } : {}),
          ...(typeof options.maxMatches === 'number' ? { max_matches: options.maxMatches } : {}),
        },
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 20000);
    const data = response?.data || response;
    const success = data?.success !== false;
    if (!success) {
      const err = data?.error || response?.error;
      throw new Error(err || 'highlight_element failed');
    }
    return {
      success: true,
      source: 'ws',
      details: data?.data || data,
    };
  }

  async sendHighlightDomPathViaWs(sessionId, domPath, options = {}) {
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'dev_command',
        action: 'highlight_dom_path',
        parameters: {
          path: domPath,
          ...(options.style ? { style: options.style } : {}),
          ...(typeof options.duration === 'number' ? { duration: options.duration } : {}),
          ...(options.channel ? { channel: options.channel } : {}),
          ...(typeof options.sticky === 'boolean' ? { sticky: options.sticky } : {}),
          ...(options.rootSelector ? { root_selector: options.rootSelector } : {}),
        },
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 20000);
    const data = response?.data || response;
    const success = data?.success !== false;
    if (!success) {
      const err = data?.error || response?.error;
      throw new Error(err || 'highlight_dom_path failed');
    }
    return {
      success: true,
      source: 'ws',
      details: data?.data || data,
    };
  }

  async sendClearHighlightViaWs(sessionId, channel = null) {
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'dev_command',
        action: 'clear_highlight',
        parameters: channel ? { channel } : {},
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 10000);
    const data = response?.data || response;
    if (data?.success === false) {
      throw new Error(data?.error || 'clear_highlight failed');
    }
    return data?.data || data || { removed: 0 };
  }

  async sendCancelDomPickViaWs(sessionId) {
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'dev_command',
        action: 'cancel_dom_pick',
        parameters: {},
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 10000);
    const data = response?.data || response;
    if (data?.success === false) {
      throw new Error(data?.error || 'cancel_dom_pick failed');
    }
    return data?.data || data || { cancelled: false };
  }

  async sendExecuteViaWs(sessionId, script) {
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'node_execute',
        node_type: 'evaluate',
        parameters: {
          script,
        },
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 10000);
    const data = response?.data || response;
    if (data?.success === false) {
      throw new Error(data?.error || 'execute failed');
    }
    return data?.data || data || { result: null };
  }

  async sendDomPickerViaWs(sessionId, options = {}) {
    const timeout = Math.min(Math.max(Number(options.timeout) || 25000, 3000), 60000);
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'node_execute',
        node_type: 'pick_dom',
        parameters: {
          timeout,
          ...(options.rootSelector ? { root_selector: options.rootSelector } : {}),
        },
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, timeout + 5000);
    const data = response?.data;
    if (data?.success === false) {
      throw new Error(data?.error || 'pick_dom failed');
    }
    const result = data?.data || data;
    if (!result) {
      throw new Error('picker result missing');
    }
    return result;
  }

  async fetchContainerSnapshotFromService({ sessionId, url, maxDepth, maxChildren, rootContainerId, rootSelector }) {
    if (!sessionId || !url) {
      throw new Error('缺少 sessionId 或 URL');
    }
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'container_operation',
        action: 'inspect_tree',
        page_context: { url },
        parameters: {
          ...(typeof maxDepth === 'number' ? { max_depth: maxDepth } : {}),
          ...(typeof maxChildren === 'number' ? { max_children: maxChildren } : {}),
          ...(rootContainerId ? { root_container_id: rootContainerId } : {}),
          ...(rootSelector ? { root_selector: rootSelector } : {}),
        },
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 20000);
    if (response?.data?.success) {
      return response.data.data || response.data.snapshot || response.data;
    }
    throw new Error(response?.data?.error || response?.error || 'inspect_tree failed');
  }

  async fetchDomBranchFromService({ sessionId, url, path, rootSelector, maxDepth, maxChildren }) {
    if (!sessionId || !url || !path) {
      throw new Error('缺少 sessionId / URL / DOM 路径');
    }
    
    // 使用 WebSocket 而不是 CLI（避免 fixture 依赖）
    const payload = {
      type: 'command',
      session_id: sessionId,
      data: {
        command_type: 'container_operation',
        action: 'inspect_dom_branch',
        page_context: { url },
        parameters: {
          path,
          ...(rootSelector ? { root_selector: rootSelector } : {}),
          ...(typeof maxDepth === 'number' ? { max_depth: maxDepth } : {}),
          ...(typeof maxChildren === 'number' ? { max_children: maxChildren } : {}),
        },
      },
    };
    const response = await this.sendWsCommand(this.getBrowserWsUrl(), payload, 20000);
    if (response?.data?.success) {
      const data = response.data.data || response.data.branch || response.data;
      // 适配：确保返回结构包含 path 和 node 字段
      if (data && !data.node && data.path) {
        const nodeData = { 
          path: data.path, 
          children: data.children || [], 
          childCount: data.node_count || (data.children?.length || 0) 
        };
        if (data.tag) nodeData.tag = data.tag;
        if (data.id) nodeData.id = data.id;
        if (data.classes) nodeData.classes = data.classes;
        return { path: data.path, node: nodeData };
      }
      return data;
    }
    throw new Error(response?.data?.error || response?.error || 'inspect_dom_branch failed');
  }

  // v2 DOM branch：按 domPath + depth 获取局部树
  async handleDomBranch2(payload = {}) {
    const profile = payload.profile || payload.sessionId;
    const url = payload.url;
    const path = payload.path || payload.domPath;
    if (!profile) throw new Error('缺少会话/ profile 信息');
    if (!url) throw new Error('缺少 URL');
    if (!path) throw new Error('缺少 DOM 路径');
    const maxDepth = typeof payload.maxDepth === 'number' ? payload.maxDepth : payload.depth;
    const maxChildren = typeof payload.maxChildren === 'number' ? payload.maxChildren : (payload.maxChildren || 12);
    const rootSelector = payload.rootSelector || payload.root_selector || null;
    const sessionId = profile;
    const branch = await this.fetchDomBranchFromService({
      sessionId,
      url,
      path,
      rootSelector,
      maxDepth: typeof maxDepth === 'number' ? maxDepth : undefined,
      maxChildren: typeof maxChildren === 'number' ? maxChildren : undefined,
    });
    return { success: true, data: branch };
  }

  async captureSnapshotFromFixture({ profileId, url, maxDepth, maxChildren, containerId, rootSelector }) {
    throw new Error('fixture snapshot fallback has been removed; use active browser session snapshot');
  }

  async captureBranchFromFixture({ profileId, url, path: domPath, rootSelector, maxDepth, maxChildren }) {
    throw new Error('fixture branch fallback has been removed; use active browser session branch');
  }

  async captureInspectorSnapshot(options = {}) {
    const profile = options.profile;
    const sessions = await this.fetchSessions();
    const targetSession = profile ? this.findSessionByProfile(sessions, profile) : sessions[0] || null;
    const sessionId = targetSession?.session_id || targetSession?.sessionId || profile || null;
    const profileId = profile || targetSession?.profileId || targetSession?.profile_id || sessionId || null;
    const targetUrl = options.url || targetSession?.current_url || targetSession?.currentUrl;
    const requestedContainerId = options.containerId || options.rootContainerId;
    if (!targetUrl) {
      throw new Error('无法确定会话 URL，请先在浏览器中打开目标页面');
    }
    let liveError = null;
    let snapshot = null;
    if (sessionId) {
      try {
        snapshot = await this.fetchContainerSnapshotFromService({
          sessionId,
          url: targetUrl,
          maxDepth: options.maxDepth,
          maxChildren: options.maxChildren,
          rootContainerId: requestedContainerId,
          rootSelector: options.rootSelector,
        });
      } catch (err) {
        liveError = err;
      }
    }
    if (!snapshot || !snapshot.container_tree) {
      const rootError = liveError || new Error('容器树为空，检查容器定义或选择器是否正确');
      throw rootError;
    }
    if (requestedContainerId) {
      snapshot = this.focusSnapshotOnContainer(snapshot, requestedContainerId);
    }
    return {
      sessionId: sessionId || profileId || 'unknown-session',
      profileId: profileId || 'default',
      targetUrl,
      snapshot,
    };
  }

  async captureInspectorBranch(options = {}) {
    const profile = options.profile;
    const domPath = options.path;
    if (!profile) throw new Error('缺少 profile');
    if (!domPath) throw new Error('缺少 DOM 路径');
    const sessions = await this.fetchSessions();
    const targetSession = profile ? this.findSessionByProfile(sessions, profile) : sessions[0] || null;
    const sessionId = targetSession?.session_id || targetSession?.sessionId || profile || null;
    const profileId = profile || targetSession?.profileId || targetSession?.profile_id || sessionId || null;
    const targetUrl = options.url || targetSession?.current_url || targetSession?.currentUrl;
    if (!targetUrl) {
      throw new Error('无法确定会话 URL');
    }
    let branch = null;
    let liveError = null;
    if (sessionId) {
      try {
        branch = await this.fetchDomBranchFromService({
          sessionId,
          url: targetUrl,
          path: domPath,
          rootSelector: options.rootSelector,
          maxDepth: options.maxDepth,
          maxChildren: options.maxChildren,
        });
      } catch (err) {
        liveError = err;
      }
    }
    if (!branch?.node) {
      throw liveError || new Error('无法获取 DOM 分支');
    }
    return {
      sessionId: sessionId || profileId || 'unknown-session',
      profileId: profileId || 'default',
      targetUrl,
      branch,
    };
  }

  async runCliCommand(target, args = []) {
    return this.cliBridge.runCliCommand(target, args);
  }

  async fetchSessions() {
    return this.cliBridge.fetchSessions();
  }

  findSessionByProfile(sessions, profile) {
    return this.cliBridge.findSessionByProfile(sessions, profile);
  }

  getBrowserWsUrl() {
    return this.transport.getBrowserWsUrl();
  }

  getBrowserHttpBase() {
    return this.transport.getBrowserHttpBase();
  }

  async browserServiceCommand(action, args, options = {}) {
    return this.transport.browserServiceCommand(action, args, options);
  }

  sendWsCommand(wsUrl, payload, timeoutMs = 15000) {
    return this.transport.sendWsCommand(wsUrl, payload, timeoutMs);
  }

  focusSnapshotOnContainer(snapshot, containerId) {
    if (!containerId || !snapshot?.container_tree) {
      return snapshot;
    }
    const target = this.cloneContainerSubtree(snapshot.container_tree, containerId);
    if (!target) {
      return snapshot;
    }
    const nextSnapshot = {
      ...snapshot,
      container_tree: target,
      metadata: {
        ...(snapshot.metadata || {}),
        root_container_id: containerId,
      },
    };
    if (!nextSnapshot.root_match || nextSnapshot.root_match?.container?.id !== containerId) {
      nextSnapshot.root_match = {
        container: {
          id: containerId,
          ...(target.name ? { name: target.name } : {}),
        },
        matched_selector: target.match?.matched_selector,
      };
    }
    return nextSnapshot;
  }

  cloneContainerSubtree(node, targetId) {
    if (!node) return null;
    if (node.id === targetId || node.container_id === targetId) {
      return this.deepClone(node);
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const match = this.cloneContainerSubtree(child, targetId);
        if (match) return match;
      }
    }
    return null;
  }

  deepClone(payload) {
    return JSON.parse(JSON.stringify(payload));
  }

}
