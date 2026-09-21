// Command handlers for daemon. truth_owner: daemon.
//
// Handles the switch-case dispatch for all 24 daemon commands.
// Delegated from daemon/index.mjs:handleCommand().

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { browserCommandNames, isBrowserCommand } from './browser_commands.mjs';
import { projectStatus } from './status_projection.mjs';

async function importOp(opName) {
  const { [opName]: fn } = await import('../../services/page_runtime/input_pipeline.mjs');
  return fn;
}

async function resolveTarget(args, ctx) {
  const { resolveTarget: resolveOwnedTarget } = await import('../../services/browser_service/bootstrap.mjs');
  const target = await resolveOwnedTarget({
    target: args?.target || null,
    profileId: ctx.profile || null,
  });
  return {
    targetId: target.targetId,
    profileId: target.profileId,
    pageId: target.pageId,
    page: target.page,
    status: target.status,
  };
}

async function resolveProfileTargets(profileId) {
  const { listTargets, resolveTarget: resolveOwnedTarget } = await import('../../services/browser_service/bootstrap.mjs');
  const listed = await listTargets({ profileId });
  const active = [];
  for (const target of listed) {
    try {
      active.push(await resolveOwnedTarget({ target: target.targetId, profileId }));
    } catch (cause) {
      if (cause?.code !== 'E_STATE_INVALID') throw cause;
    }
  }
  if (active.length === 0) {
    throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'browser_target', profileId } });
  }
  return active;
}

function withTargetArgs(target, args = {}) {
  return {
    ...args,
    profileId: target.profileId,
    target: {
      targetId: target.targetId,
      profileId: target.profileId,
      pageId: target.pageId,
      page: target.page,
      status: target.status,
    },
  };
}

/**
 * Handle a command. Delegates to input_pipeline operations.
 * @param {string} cmd - command name
 * @param {Object} args - command arguments
 * @param {Object} ctx - execution context
 * @param {string} ctx.profile - profile identifier
 * @param {Object} ctx.opts - daemon options (for browser lifecycle)
 * @param {Function} ctx.ensureBrowser - browser ensure function
 * @returns {Object} command result { ok, ... }
 */
export async function handleCommand(cmd, args, ctx) {
  const { opts, ensureBrowser, ephemeralAllocations } = ctx;
  const requestedProfile = ctx.profile;
  const resolvedProfile = ephemeralAllocations?.get(requestedProfile) || requestedProfile;
  const profile = cmd === 'start' || cmd === 'stop' ? requestedProfile : resolvedProfile;

  // start owns allocation; every later browser command must reuse its
  // resolved ephemeral profile instead of launching the alias itself.
  if (isBrowserCommand(cmd) && cmd !== 'start') {
    if (requestedProfile === 'temp' && !ephemeralAllocations?.has(requestedProfile)) {
      throw new CamoError({
        code: 'E_STATE_NOT_FOUND',
        details: { resource: 'ephemeral_allocations', alias: requestedProfile },
      });
    }
    await ensureBrowser(resolvedProfile);
  }

  switch (cmd) {
    case 'status': {
      return projectStatus({ args, opts });
    }

    case 'start': {
      const { startSession, hasBrowser, getSession, resolveTarget: resolveOwnedTarget } = await import('../../services/browser_service/bootstrap.mjs');
      const goto = await importOp('goto');
      const requestedProfile = profile;
      const ephemeralRequested = (args && args.ephemeral === true) || requestedProfile === 'temp';

      // Resolve temp alias to the current allocation (if any) before checking
      // for an existing browser, otherwise hasBrowser would never see a temp
      // session whose allocation map points at a fresh _temp_<pid>_<ts> id.
      const allocatedProfile = ctx.ephemeralAllocations.get(requestedProfile);
      const aliasedProfile = allocatedProfile || requestedProfile;
      const existing = hasBrowser(aliasedProfile);
      const requestedHeadless = (args && args.headless === true) || opts.mode === 'headless';
      if (allocatedProfile && !existing) {
        throw new CamoError({
          code: 'E_STATE_INVALID',
          details: { resource: 'ephemeral_allocations', alias: requestedProfile, profileId: aliasedProfile, reason: 'allocation has no active browser' },
        });
      }
      if (existing) {
        const session = await getSession(aliasedProfile);
        const sessionHeadless = session?.headless === true;
        if (typeof args?.headless === 'boolean' && requestedHeadless !== sessionHeadless) {
          throw new CamoError({
            code: 'E_STATE_INVALID',
            details: {
              resource: 'browser_session',
              profileId: aliasedProfile,
              reason: `session already running with headless=${sessionHeadless}; requested headless=${requestedHeadless}. Stop the session first, then start with --headless.`,
            },
          });
        }
        const target = await resolveOwnedTarget({ profileId: aliasedProfile });
        if (args && typeof args.url === 'string' && args.url) {
          await goto(withTargetArgs(target, { url: args.url, waitUntil: 'domcontentloaded' }));
        }
        if (allocatedProfile) ctx.ephemeralAllocations.set(requestedProfile, aliasedProfile);
        return {
          ok: true,
          sessionId: (await getSession(aliasedProfile))?.instanceId || null,
          profile: aliasedProfile,
          target: target.targetId,
          ephemeral: allocatedProfile !== undefined,
          reused: true,
        };
      }
      const session = await startSession({
        profileId: requestedProfile,
        headless: requestedHeadless,
        ephemeral: ephemeralRequested,
      });
      const effectiveProfile = session.profileId || requestedProfile;
      if (session.ephemeral === true) ctx.ephemeralAllocations.set(requestedProfile, effectiveProfile);
      if (args && typeof args.url === 'string' && args.url) {
        const target = await resolveOwnedTarget({ profileId: effectiveProfile });
        await goto(withTargetArgs(target, { url: args.url, waitUntil: 'domcontentloaded' }));
      }
      return {
        ok: true,
        sessionId: session.sessionId,
        profile: effectiveProfile,
        target: session.target,
        ephemeral: session.ephemeral === true,
      };
    }

    case 'stop': {
      const { stopSession, deleteTempProfile } = await import('../../services/browser_service/bootstrap.mjs');
      // Resolve the alias 'temp' to the allocated ephemeral id; do NOT match
      // by prefix, that would let any profile whose id starts with the
      // literal "temp" close a different allocated session.
      const allocated = ctx.ephemeralAllocations.get(profile);
      let resolvedProfile = allocated || profile;
      if (profile === 'temp' && !allocated) {
          throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'ephemeral_allocations', alias: 'temp' } });
      }
      const result = await stopSession(resolvedProfile);
      if (result.ephemeral === true) {
        const cleanup = await deleteTempProfile(resolvedProfile);
        if (cleanup.cleaned !== true) {
          throw new CamoError({
            code: 'E_BROWSER_CLEANUP_FAILED',
            details: {
              resource: 'temporary_profile',
              profileId: resolvedProfile,
              cleanup: cleanup.pendingCleanup,
            },
          });
        }
      }
      // Clean up any tracked ephemeral allocation maps for this alias.
      for (const [alias, alloc] of [...ctx.ephemeralAllocations.entries()]) {
        if (alloc === resolvedProfile) ctx.ephemeralAllocations.delete(alias);
      }
      return { ok: true, stopped: true, profile: resolvedProfile, ephemeral: result && result.ephemeral === true };
    }

    case 'goto': {
      const goto = await importOp('goto');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await goto(withTargetArgs(target, { url: args.url, waitUntil: args.waitUntil || 'load' }));
      return { ok: true, target: target.targetId, navigated: true, url: args.url, finalUrl: r.finalUrl, statusCode: r.statusCode };
    }

    case 'back': {
      const back = await importOp('back');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await back(withTargetArgs(target));
      return { ok: true, target: target.targetId, navigated: r.navigated === true, finalUrl: r.finalUrl };
    }

    case 'forward': {
      const forward = await importOp('forward');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await forward(withTargetArgs(target));
      return { ok: true, target: target.targetId, navigated: r.navigated === true, finalUrl: r.finalUrl };
    }

    case 'reload': {
      const reload = await importOp('reload');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await reload(withTargetArgs(target, { waitUntil: args.waitUntil || 'load' }));
      return { ok: true, target: target.targetId, reloaded: true, finalUrl: r.finalUrl, statusCode: r.statusCode };
    }

    case 'click': {
      const click = await importOp('click');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await click(withTargetArgs(target, {
        selector: args.selector,
        text: args.text,
        button: args.button || 'left',
        dialogAction: args.dialogAction,
        dialogText: args.dialogText,
        timeout: args.timeout,
      }));
      return { ok: true, target: target.targetId, clicked: true, dialog: r.dialog || null };
    }

    case 'type': {
      const type = await importOp('type');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await type(withTargetArgs(target, { text: args.text, selector: args.selector, delay: args.delay }));
      return { ok: true, target: target.targetId, typed: true, typedChars: r.length };
    }

    case 'keyboard': {
      const keyboard = await importOp('keyboard');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await keyboard(withTargetArgs(target, {
        action: args.action,
        key: args.key,
        timeout: args.timeout,
      }));
      return { ok: true, target: target.targetId, pressed: true, action: r.action, key: r.key };
    }
    case 'scroll': {
      const scroll = await importOp('scroll');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await scroll(withTargetArgs(target, { x: args.dx, y: args.dy, atX: args.atX, atY: args.atY }));
      return { ok: true, target: target.targetId, scrolled: true };
    }

    case 'screenshot': {
      const screenshot = await importOp('screenshot');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await screenshot(withTargetArgs(target, { fullPage: args.fullPage === true, path: args.path }));
      return { ok: true, target: target.targetId, screenshot: true, format: r.format, size: r.size, saved: r.saved || false, savedPath: r.savedPath || null };
    }

    case 'snapshot': {
      const snapshot = await importOp('snapshot');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await snapshot(withTargetArgs(target));
      return { ok: true, target: target.targetId, snapshot: true, url: r.url, htmlLength: r.htmlLength, html: r.html };
    }

    case 'wait': {
      const wait = await importOp('wait');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await wait(withTargetArgs(target, { for_: args.for || 'load', condition: args.condition || null, timeout: args.timeout, ms: args.ms }));
      return { ok: true, target: target.targetId, waited: true, satisfied: r.satisfied === true, for: r.for, condition: r.condition, timeout: r.timeout };
    }

    case 'evaluate': {
      const evaluate = await importOp('evaluate');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await evaluate(withTargetArgs(target, { script: args.script }));
      return { ok: true, target: target.targetId, evaluated: true, result: r.result };
    }

    case 'upload': {
      const upload = await importOp('upload');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await upload(withTargetArgs(target, { selector: args.selector, files: args.files }));
      return { ok: true, target: target.targetId, uploaded: true, fileCount: r.fileCount };
    }

    case 'select': {
      const select = await importOp('select');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await select(withTargetArgs(target, { selector: args.selector, value: args.value }));
      return { ok: true, target: target.targetId, selected: true };
    }

    case 'close-tab': {
      const closeTab = await importOp('closeTab');
      const { invalidateTarget } = await import('../../services/browser_service/bootstrap.mjs');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await closeTab(withTargetArgs(target));
      await invalidateTarget(target.targetId);
      return { ok: true, target: target.targetId, page: target.pageId, closed: r.closed === true };
    }

    case 'switch-tab': {
      const switchTab = await importOp('switchTab');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await switchTab(withTargetArgs(target));
      return { ok: true, target: target.targetId, page: target.pageId, switched: true, url: r.url };
    }

    case 'daemon': {
      const { listSessionDetails } = await import('../../services/browser_service/bootstrap.mjs');
      const sessions = await listSessionDetails();
      return {
        ok: true,
        daemonId: opts.daemonId,
        mode: opts.mode,
        profile: opts.profile,
        profiles: sessions.map((s) => s.profileId),
        browserCount: sessions.length,
      };
    }

    case 'fetch-page': {
      const fetch = await importOp('fetch');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await fetch(withTargetArgs(target, { url: args.url, timeout: args.timeout }));
      return { ok: true, target: target.targetId, fetched: true, fetchOk: r.ok === true, status: r.status, bodyLength: r.bodyLength, body: r.body };
    }

    case 'find-elements': {
      const findElements = await importOp('findElements');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await findElements(withTargetArgs(target, { selector: args.selector, text: args.text }));
      return { ok: true, target: target.targetId, found: true, count: r.count, elements: r.elements };
    }

    case 'get-cookies': {
      const getCookies = await importOp('getCookies');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await getCookies(withTargetArgs(target));
      return { ok: true, target: target.targetId, count: r.count, cookies: r.cookies };
    }
    case 'get-page-info': {
      const getPageInfo = await importOp('getPageInfo');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await getPageInfo(withTargetArgs(target));
      return {
        ok: true,
        target: target.targetId,
        page: target.pageId,
        url: r.url,
        title: r.title,
        viewportWidth: r.viewportWidth,
        viewportHeight: r.viewportHeight,
        scrollWidth: r.scrollWidth,
        scrollHeight: r.scrollHeight,
        scrollX: r.scrollX,
        scrollY: r.scrollY,
        readyState: r.readyState,
      };
    }

    case 'get-readable': {
      const getReadable = await importOp('getReadable');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await getReadable(withTargetArgs(target, { maxLength: args.maxLength }));
      return { ok: true, target: target.targetId, text: r.text, length: r.length };
    }

    case 'get-text': {
      const getText = await importOp('getText');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await getText(withTargetArgs(target, { selector: args.selector }));
      return { ok: true, target: target.targetId, text: r.text };
    }
    case 'hover': {
      const hover = await importOp('hover');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await hover(withTargetArgs(target, { selector: args.selector, text: args.text }));
      return { ok: true, target: target.targetId, hovered: true };
    }

    case 'list-tabs': {
      const listTabs = await importOp('listTabs');
      const targets = args?.target
        ? [await resolveTarget(args, { ...ctx, profile })]
        : await resolveProfileTargets(profile);
      const r = await listTabs({ profileId: profile, targets });
      return { ok: true, count: r.count, tabs: r.tabs };
    }

    case 'new-tab': {
      const newTab = await importOp('newTab');
      const { allocateTargetForPage } = await import('../../services/browser_service/bootstrap.mjs');
      const parent = await resolveTarget(args, { ...ctx, profile });
      const r = await newTab(withTargetArgs(parent, { url: args.url }));
      const created = await allocateTargetForPage(profile, r.page);
      return { ok: true, newTab: true, created: true, target: created.targetId, page: created.pageId, url: r.url };
    }

    case 'multi-open': {
      const multiOpen = await importOp('multiOpen');
      const { allocateTargetForPage } = await import('../../services/browser_service/bootstrap.mjs');
      const parent = await resolveTarget(args, { ...ctx, profile });
      const r = await multiOpen(withTargetArgs(parent, { urls: args.urls, outDir: args.outDir || null, prefix: args.prefix || 'multi-open' }));
      const opened = [];
      const screenshots = [];
      for (const entry of r.opened) {
        const created = await allocateTargetForPage(profile, entry.page);
        opened.push({ target: created.targetId, page: created.pageId, url: entry.url });
        const shotIndex = r.screenshots.findIndex((shot) => shot.page === entry.page);
        const shot = shotIndex >= 0 ? r.screenshots[shotIndex] : null;
        screenshots.push({
          target: created.targetId,
          page: created.pageId,
          url: entry.url,
          size: shot?.size ?? 0,
          path: shot?.path ?? null,
        });
      }
      return { ok: true, opened, screenshots, errors: r.errors };
    }

    case 'scroll-and-collect': {
      const scrollAndCollect = await importOp('scrollAndCollect');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await scrollAndCollect(withTargetArgs(target, { scrollCount: args.scrollCount, scrollDelay: args.scrollDelay }));
      return { ok: true, target: target.targetId, scrolled: true, collected: r.collected };
    }

    case 'set-cookies': {
      const setCookies = await importOp('setCookies');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await setCookies(withTargetArgs(target, { cookies: args.cookies }));
      return { ok: true, target: target.targetId, count: r.count, set: r.set };
    }

    case 'set-user-agent': {
      const { run: runSerialized } = await import('../../services/page_runtime/input_pipeline.mjs');
      const { setSessionUserAgent } = await import('../../services/browser_service/bootstrap.mjs');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await runSerialized(
        profile,
        { kind: 'setuseragent', params: { userAgent: args.userAgent, targetId: target.targetId } },
        () => setSessionUserAgent({ profileId: profile, userAgent: args.userAgent }),
      );
      return { ok: true, target: r.target, previousTarget: target.targetId, set: r.set === true, userAgent: r.userAgent };
    }

    case 'set-viewport': {
      const setViewport = await importOp('setViewport');
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await setViewport(withTargetArgs(target, { width: args.width, height: args.height }));
      return { ok: true, target: target.targetId, set: r.set === true, width: r.width, height: r.height };
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
      const target = await resolveTarget(args, { ...ctx, profile });
      const r = await waitForDomStable(withTargetArgs(target, { timeout: args.timeout, pollInterval: args.pollInterval }));
      return { ok: true, target: target.targetId, stable: r.stable === true, reason: r.reason ?? null, elapsed: r.elapsed ?? null };
    }

    default:
      throw new CamoError({
        code: 'E_PROTO_NO_HANDLER',
        details: { cmd, known: ['start', 'stop', 'close-tab', 'daemon', 'fetch-page', 'find-elements', 'get-cookies', 'get-page-info', 'get-readable', 'get-text', 'list-tabs', 'new-tab', 'multi-open', 'scroll-and-collect', 'set-cookies', 'set-user-agent', 'set-viewport', 'wait-dom-stable', ...browserCommandNames(), 'search'] }
      });
  }
}
