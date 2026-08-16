// Command handlers for daemon. truth_owner: daemon.
//
// Handles the switch-case dispatch for all 24 daemon commands.
// Delegated from daemon/index.mjs:handleCommand().

import { CamoError, project as projectError } from '../../contracts/error_envelope/projector.mjs';
import { append as appendProgress } from '../../services/progress_event/log.mjs';
import { browserCommandNames, isBrowserCommand } from './browser_commands.mjs';

function emit(profileId, type, payload) {
  appendProgress({ event: type, source: 'daemon_handler', profileId, payload, ts: new Date().toISOString() });
}

async function importOp(opName) {
  const { [opName]: fn } = await import('../../services/page_runtime/input_pipeline.mjs');
  return fn;
}

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

  if (isBrowserCommand(cmd)) {
    await ensureBrowser(profile, false);
    closeAfter = isEphemeral;
  }

  switch (cmd) {
    case 'start': {
      const { startSession, hasBrowser, getCurrentPage, getSession } = await import('../../services/browser_service/bootstrap.mjs');
      const requestedProfile = profile;
      const ephemeralRequested = (args && args.ephemeral === true) || requestedProfile === 'temp';

      // Resolve temp alias to the current allocation (if any) before checking
      // for an existing browser, otherwise hasBrowser would never see a temp
      // session whose allocation map points at a fresh _temp_<pid>_<ts> id.
      const allocatedProfile = ctx.ephemeralAllocations.get(requestedProfile);
      const aliasedProfile = allocatedProfile || requestedProfile;
      const existing = hasBrowser(aliasedProfile);
      if (allocatedProfile && !existing) {
        throw new CamoError({
          code: 'E_STATE_INVALID',
          details: { resource: 'ephemeral_allocations', alias: requestedProfile, profileId: aliasedProfile, reason: 'allocation has no active browser' },
        });
      }
      if (existing) {
        const page = getCurrentPage(aliasedProfile);
        const targetUrl = (args && typeof args.url === 'string' && args.url) ? args.url : 'about:blank';
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        browserState.currentBrowserProfile = aliasedProfile;
        if (allocatedProfile) ctx.ephemeralAllocations.set(requestedProfile, aliasedProfile);
        return { ok: true, sessionId: (await getSession(aliasedProfile))?.instanceId || null, profile: aliasedProfile, reused: true };
      }
      const session = await startSession({
        profileId: requestedProfile,
        headless: opts.mode === 'headless',
        ephemeral: ephemeralRequested,
      });
      const effectiveProfile = session.profileId || requestedProfile;
      browserState.currentBrowserProfile = effectiveProfile;
      browserState.browserRefCount = 1;
      if (session.ephemeral === true) ctx.ephemeralAllocations.set(requestedProfile, effectiveProfile);
      if (args && typeof args.url === 'string' && args.url) {
        const fresh = getCurrentPage(effectiveProfile);
        await fresh.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      return { ok: true, sessionId: session.sessionId, profile: effectiveProfile, ephemeral: session.ephemeral === true };
    }

    case 'stop': {
      const { stopSession } = await import('../../services/browser_service/bootstrap.mjs');
      // Resolve the alias 'temp' to the allocated ephemeral id; do NOT match
      // by prefix, that would let any profile whose id starts with the
      // literal "temp" close a different allocated session.
      const allocated = ctx.ephemeralAllocations.get(profile);
      let resolvedProfile = allocated || profile;
      if (profile === 'temp' && !allocated) {
          throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'ephemeral_allocations', alias: 'temp' } });
      }
      const result = await stopSession(resolvedProfile);
      browserState.currentBrowserProfile = null;
      browserState.browserRefCount = 0;
      // Clean up any tracked ephemeral allocation maps for this alias.
      for (const [alias, alloc] of [...ctx.ephemeralAllocations.entries()]) {
        if (alloc === resolvedProfile) ctx.ephemeralAllocations.delete(alias);
      }
      return { ok: true, stopped: true, profile: resolvedProfile, ephemeral: result && result.ephemeral === true };
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
      const r = await type({ profileId: profile, text: args.text, selector: args.selector, delay: args.delay });
      return { ok: true, typed: true, typedChars: r.length };
    }

    case 'scroll': {
      const scroll = await importOp('scroll');
      const r = await scroll({ profileId: profile, x: args.dx, y: args.dy, atX: args.atX, atY: args.atY });
      return { ok: true, scrolled: true };
    }

    case 'screenshot': {
      const screenshot = await importOp('screenshot');
      const r = await screenshot({ profileId: profile, fullPage: args.fullPage === true, path: args.path });
      return { ok: true, screenshot: true, format: r.format, size: r.size, saved: r.saved || false, savedPath: r.savedPath || null };
    }

    case 'snapshot': {
      const snapshot = await importOp('snapshot');
      const r = await snapshot({ profileId: profile });
      return { ok: true, snapshot: true, url: r.url, htmlLength: r.htmlLength };
    }

    case 'wait': {
      const wait = await importOp('wait');
      const r = await wait({ profileId: profile, for_: args.for || 'load', target: args.target || null, timeout: args.timeout, ms: args.ms });
      return { ok: true, waited: true, satisfied: r.satisfied === true, for: r.for, target: r.target, timeout: r.timeout };
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

    case 'switch-tab': {
      const switchTab = await importOp('switchTab');
      const r = await switchTab({ profileId: profile, tabId: args.tabId });
      return { ok: true, switched: true, tabId: r.tabId, url: r.url };
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
      return { ok: true, text: r.text, length: r.length };
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
      return { ok: true, newTab: true, created: true, tabId: r.tabId, url: r.url };
    }

    case 'multi-open': {
      const multiOpen = await importOp('multiOpen');
      const r = await multiOpen({ profileId: profile, urls: args.urls, outDir: args.outDir || null, prefix: args.prefix || 'multi-open' });
      return { ok: true, opened: r.opened, screenshots: r.screenshots, errors: r.errors };
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
      return { ok: true, set: r.set === true, width: r.width, height: r.height };
    }

    case 'search': {
      const { run: runSearch } = await import('../../commands/builtins/search/index.mjs');
      const parsed = {
        profile,
        positional: [args.platform || 'xhs', args.query || ''],
        named: {
          profile,
          cookies: args.cookies,
          'max-results': args.maxResults,
          headless: args.headless,
        },
      };
      const result = await runSearch(null, parsed, { profile });
      return {
        ok: result.success,
        searched: result.searched,
        results: result.results,
        totalCount: result.totalCount,
        pageURL: result.pageURL,
        error: result.error,
        requires_login: result.requires_login,
      };
    }

    case 'wait-dom-stable': {
      const waitForDomStable = await importOp('waitForDomStable');
      const r = await waitForDomStable({ profileId: profile, timeout: args.timeout, pollInterval: args.pollInterval });
      return { ok: true, stable: true, durationMs: r.durationMs };
    }

    default:
      throw new CamoError({
        code: 'E_PROTO_NO_HANDLER',
        details: { cmd, known: ['start', 'stop', 'close-tab', 'daemon', 'fetch-page', 'find-elements', 'get-cookies', 'get-page-info', 'get-readable', 'get-text', 'list-tabs', 'new-tab', 'multi-open', 'scroll-and-collect', 'set-cookies', 'set-user-agent', 'set-viewport', 'wait-dom-stable', ...browserCommandNames(), 'search'] }
      });
  }
}
