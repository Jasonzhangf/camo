// Command handlers for daemon. truth_owner: daemon.
//
// Handles the switch-case dispatch for all 24 daemon commands.
// Delegated from daemon/index.mjs:handleCommand().

import { CamoError, project as projectError } from '../../contracts/error_envelope/projector.mjs';
import { append as appendProgress } from '../../services/progress_event/log.mjs';

function emit(profileId, type, payload) {
  appendProgress({ event: type, source: 'daemon_handler', profileId, payload, ts: new Date().toISOString() });
}

async function importOp(opName) {
  const { [opName]: fn } = await import('../../services/page_runtime/input_pipeline.mjs');
  return fn;
}

const browserCmds = new Set(['goto', 'click', 'type', 'scroll', 'screenshot', 'snapshot', 'wait', 'evaluate', 'upload', 'select']);

/**
 * Handle a command. Delegates to input_pipeline operations.
 * @param {string} cmd - command name
 * @param {Object} args - command arguments
 * @param {Object} ctx - execution context
 * @param {string} ctx.profile - profile identifier
 * @param {boolean} ctx.isEphemeral - whether the session is ephemeral
 * @param {Object} ctx.opts - daemon options (for browser lifecycle)
 * @param {Function} ctx.ensureBrowser - browser ensure function
 * @param {Function} ctx.releaseBrowser - browser release function
 * @param {Object} ctx.browserState - { currentBrowserProfile, browserRefCount }
 * @returns {Object} command result { ok, ... }
 */
export async function handleCommand(cmd, args, ctx) {
  const { profile, isEphemeral, opts, ensureBrowser, releaseBrowser, browserState } = ctx;
  let closeAfter = false;

  if (browserCmds.has(cmd)) {
    await ensureBrowser(profile, false);
    closeAfter = isEphemeral;
  }

  switch (cmd) {
    case 'start': {
      const { startSession } = await import('../../services/browser_service/bootstrap.mjs');
      const session = await startSession({ profileId: profile, headless: opts.mode === 'headless' });
      browserState.currentBrowserProfile = profile;
      browserState.browserRefCount = 1;
      return { ok: true, sessionId: session.sessionId, profile: session.profileId };
    }

    case 'stop': {
      const { stopSession } = await import('../../services/browser_service/bootstrap.mjs');
      await stopSession(profile);
      browserState.currentBrowserProfile = null;
      browserState.browserRefCount = 0;
      return { ok: true, stopped: true, profile };
    }

    case 'goto': {
      const goto = await importOp('goto');
      const r = await goto({ profileId: profile, url: args.url, waitUntil: args.waitUntil || 'load' });
      return { ok: true, navigated: true, url: args.url, finalUrl: r.finalUrl, statusCode: r.statusCode };
    }

    case 'click': {
      const click = await importOp('click');
      const r = await click({ profileId: profile, selector: args.selector, text: args.text, button: args.button || 'left' });
      return { ok: true, clicked: true };
    }

    case 'type': {
      const type = await importOp('type');
      const r = await type({ profileId: profile, text: args.text, delay: args.delay });
      return { ok: true, typed: true, length: r.length };
    }

    case 'scroll': {
      const scroll = await importOp('scroll');
      const r = await scroll({ profileId: profile, x: args.x || 0, y: args.y || 0 });
      return { ok: true, scrolled: true };
    }

    case 'screenshot': {
      const screenshot = await importOp('screenshot');
      const r = await screenshot({ profileId: profile, fullPage: args.fullPage === true });
      return { ok: true, screenshot: true, format: r.format, size: r.size };
    }

    case 'snapshot': {
      const snapshot = await importOp('snapshot');
      const r = await snapshot({ profileId: profile });
      return { ok: true, snapshot: true, url: r.url, htmlLength: r.htmlLength };
    }

    case 'wait': {
      const wait = await importOp('wait');
      await wait({ profileId: profile, ms: args.ms || 1000 });
      return { ok: true, waited: true, ms: args.ms || 1000 };
    }

    case 'evaluate': {
      const evaluate = await importOp('evaluate');
      const r = await evaluate({ profileId: profile, script: args.script });
      return { ok: true, evaluated: true, result: r.result };
    }

    case 'upload': {
      const upload = await importOp('upload');
      const r = await upload({ profileId: profile, selector: args.selector, files: args.files });
      return { ok: true, uploaded: true, fileCount: r.fileCount };
    }

    case 'select': {
      const select = await importOp('select');
      const r = await select({ profileId: profile, selector: args.selector, value: args.value });
      return { ok: true, selected: true };
    }

    case 'close-tab': {
      const closeTab = await importOp('closeTab');
      const r = await closeTab({ profileId: profile, tabId: args.tabId });
      return { ok: true, closedTab: true };
    }

    case 'daemon': {
      return { ok: true, daemonId: opts.daemonId, mode: opts.mode, profile: opts.profile };
    }

    case 'fetch-page': {
      const fetch = await importOp('fetch');
      const r = await fetch({ profileId: profile, url: args.url, timeout: args.timeout });
      return { ok: true, fetched: true, statusCode: r.statusCode, headers: r.headers, body: r.body };
    }

    case 'find-elements': {
      const findElements = await importOp('findElements');
      const r = await findElements({ profileId: profile, selector: args.selector, text: args.text });
      return { ok: true, found: true, count: r.count, elements: r.elements };
    }

    case 'get-cookies': {
      const getCookies = await importOp('getCookies');
      const r = await getCookies({ profileId: profile });
      return { ok: true, count: r.count, cookies: r.cookies };
    }

    case 'get-page-info': {
      const getPageInfo = await importOp('getPageInfo');
      const r = await getPageInfo({ profileId: profile });
      return { ok: true, url: r.url, title: r.title, viewport: r.viewport };
    }

    case 'get-readable': {
      const getReadable = await importOp('getReadable');
      const r = await getReadable({ profileId: profile, maxLength: args.maxLength });
      return { ok: true, content: r.content, textLength: r.textLength };
    }

    case 'get-text': {
      const getText = await importOp('getText');
      const r = await getText({ profileId: profile, selector: args.selector });
      return { ok: true, text: r.text };
    }

    case 'hover': {
      const hover = await importOp('hover');
      const r = await hover({ profileId: profile, selector: args.selector, text: args.text });
      return { ok: true, hovered: true };
    }

    case 'list-tabs': {
      const listTabs = await importOp('listTabs');
      const r = await listTabs({ profileId: profile });
      return { ok: true, tabs: r.tabs };
    }

    case 'new-tab': {
      const newTab = await importOp('newTab');
      const r = await newTab({ profileId: profile, url: args.url });
      return { ok: true, newTab: true, tabId: r.tabId };
    }

    case 'scroll-and-collect': {
      const scrollAndCollect = await importOp('scrollAndCollect');
      const r = await scrollAndCollect({ profileId: profile, scrollCount: args.scrollCount, scrollDelay: args.scrollDelay });
      return { ok: true, scrolled: true, collected: r.collected };
    }

    case 'set-cookies': {
      const setCookies = await importOp('setCookies');
      const r = await setCookies({ profileId: profile, cookies: args.cookies });
      return { ok: true, count: r.count, set: r.set };
    }

    case 'set-user-agent': {
      const setUserAgent = await importOp('setUserAgent');
      const r = await setUserAgent({ profileId: profile, userAgent: args.userAgent });
      return { ok: true, userAgentSet: true };
    }

    case 'set-viewport': {
      const setViewport = await importOp('setViewport');
      const r = await setViewport({ profileId: profile, width: args.width, height: args.height });
      return { ok: true, viewportSet: true };
    }

    case 'search': {
      const { getSearchEngine } = await import('../../services/search/SearchEngine.js');
      const { XHSSearch } = await import('../../services/search/platforms/XHSSearch.js');
      const engine = getSearchEngine();
      engine.registerPlatform('xhs', XHSSearch);
      const result = await engine.search({
        platform: args.platform || 'xhs',
        query: args.query,
        cookies: args.cookies,
        profile: profile,
        maxResults: args.maxResults,
        timeout: args.timeout,
      });
      return { ok: result.success, searched: true, results: result.results, totalCount: result.totalCount, pageURL: result.pageURL, error: result.error };
    }

    case 'wait-dom-stable': {
      const waitForDomStable = await importOp('waitForDomStable');
      const r = await waitForDomStable({ profileId: profile, timeout: args.timeout, pollInterval: args.pollInterval });
      return { ok: true, stable: true, durationMs: r.durationMs };
    }

    default:
      throw new CamoError({
        code: 'E_PROTO_NO_HANDLER',
        details: { cmd, known: ['start', 'stop', 'close-tab', 'daemon', 'fetch-page', 'find-elements', 'get-cookies', 'get-page-info', 'get-readable', 'get-text', 'hover', 'list-tabs', 'new-tab', 'scroll-and-collect', 'set-cookies', 'set-user-agent', 'set-viewport', 'wait-dom-stable', ...browserCmds, 'search'] }
      });
  }
}
