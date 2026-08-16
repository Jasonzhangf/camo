// camo v2 builtin: `camo login`
//
// Opens a persistent browser session on the requested profile, navigates
// to the login URL in foreground mode, and waits for the user to complete
// the login flow. Cookie state is auto-saved by Camoufox to
// `~/.camo/profiles/<id>/cookies.sqlite` so the login survives across
// restarts of the same profile.
//
// Completion is signalled by ANY of:
//   - `--until-url <substring>` matched against the current URL, OR
//   - `--until-cookie-name <name>` matched against any cookie name, OR
//   - `--timeout <ms>` reached (default 300000 = 5 minutes).
//
// To avoid stale-cookie false positives, the cookie signal is only
// emitted when the cookie VALUE has changed since login started (or when
// the cookie did not exist before and now does). For URL signal this is
// not an issue; the URL moves away from the login page after success.
//
// After completion the browser session stays open until the caller
// runs `camo stop --profile <id>`. Cookies are persisted by Camoufox on
// every navigation; we do NOT need an explicit save step.

import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';
import path from 'node:path';
import { PROFILE_ID_PATTERN, resolveProfileDir } from '../../services/profile/storage_paths.mjs';

export const cmd = 'login';

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) {
    throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  }
  if (!PROFILE_ID_PATTERN.test(id)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  }
  return id;
}

async function snapshotCookie(reply, name) {
  const cookies = reply?.payload?.cookies || [];
  for (const c of cookies) if (c.name === name) return { name: c.name, value: c.value || '' };
  return null;
}

export async function run(transport, parsed = {}, ctx = {}) {
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }
  const profile = safeProfile(parsed.profile);
  const url = parsed.named?.url;
  if (!url || typeof url !== 'string') {
    throw new CamoError({
      code: 'E_INPUT_MISSING_FIELD',
      details: { field: 'url', reason: 'login requires --url <https://...>' },
    });
  }
  const untilUrl = parsed.named?.untilUrl || null;
  const untilCookieName = parsed.named?.untilCookieName || null;
  if (!untilUrl && !untilCookieName) {
    throw new CamoError({
      code: 'E_INPUT_MISSING_FIELD',
      details: { field: 'untilUrl|untilCookieName', reason: 'login requires at least one completion signal' },
    });
  }
  const timeoutMs = Number.isFinite(parsed.named?.timeout) ? Number(parsed.named?.timeout) : 300_000;

  // Step 1: ensure browser is up (foreground).
  const startReply = await sendCommand(transport, {
    cmd: 'start',
    args: { profile, url, headless: false },
  });
  const effectiveProfile = startReply.payload?.profile || profile;
  const savedCookiesAt = path.join(resolveProfileDir(effectiveProfile), 'cookies.sqlite');

  // Step 2: snapshot the cookie value BEFORE we wait, so we can detect
  // a real change after the user finishes the login.
  let baselineCookie = null;
  if (untilCookieName) {
    const cookieReply = await sendCommand(transport, {
      cmd: 'get-cookies',
      args: { profile: effectiveProfile },
    });
    baselineCookie = await snapshotCookie(cookieReply, untilCookieName);
  }

  // Step 3: poll URL + cookies until either signal matches or timeout.
  const startedAt = Date.now();
  let lastUrl = url;
  let lastCookieNames = [];
  let lastPollError = null;
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const info = await sendCommand(transport, {
        cmd: 'get-page-info',
        args: { profile: effectiveProfile },
      });
      const currentUrl = info.payload?.url || info.payload?.finalUrl || '';
      lastUrl = currentUrl;
      if (untilUrl && currentUrl && currentUrl.includes(untilUrl)) {
        return {
          cmd: 'login',
          profile: effectiveProfile,
          url,
          untilUrl,
          untilCookieName,
          matched: 'url',
          lastUrl,
          durationMs: Date.now() - startedAt,
          savedCookiesAt,
          issuedAt: new Date().toISOString(),
          traceId: ctx.traceId || null,
        };
      }
      if (untilCookieName) {
        const cookieReply = await sendCommand(transport, {
          cmd: 'get-cookies',
          args: { profile: effectiveProfile },
        });
        const cookies = cookieReply.payload?.cookies || [];
        lastCookieNames = cookies.map((c) => c.name);
        const nowCookie = await snapshotCookie(cookieReply, untilCookieName);
        const baselineValue = baselineCookie ? baselineCookie.value : null;
        const nowValue = nowCookie ? nowCookie.value : null;
        if (nowValue !== null && nowValue !== baselineValue) {
          return {
            cmd: 'login',
            profile: effectiveProfile,
            url,
            untilUrl,
            untilCookieName,
            matched: 'cookie',
            lastUrl,
            cookieNames: lastCookieNames,
            durationMs: Date.now() - startedAt,
            savedCookiesAt,
            issuedAt: new Date().toISOString(),
            traceId: ctx.traceId || null,
          };
        }
      }
    } catch (cause) {
      lastPollError = cause?.message || String(cause);
    }
  }
  throw new CamoError({
    code: 'E_LOGIN_TIMEOUT',
    details: {
      profile: effectiveProfile,
      url,
      untilUrl,
      untilCookieName,
      lastUrl,
      lastCookieNames,
      lastPollError,
      timeoutMs,
      hint: 'increase --timeout or check that cookies were saved by Camoufox (savedCookiesAt path)',
    },
  });
}
