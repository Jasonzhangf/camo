import { callAPI } from '../../../utils/browser-service.mjs';
import { asErrorPayload, getCurrentUrl, normalizeArray } from '../utils.mjs';

function callWithTimeout(action, payload, timeoutMs) {
  let timer = null;
  return Promise.race([
    callAPI(action, payload),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${action} timeout after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function executeViewportOperation({ profileId, action, params = {} }) {
  if (action === 'get_current_url') {
    const url = await getCurrentUrl(profileId);
    const includes = normalizeArray(params.includes || params.urlIncludes).map((item) => String(item));
    const excludes = normalizeArray(params.excludes || params.urlExcludes).map((item) => String(item));
    const missing = includes.filter((token) => !url.includes(token));
    const forbidden = excludes.filter((token) => url.includes(token));
    if (missing.length > 0 || forbidden.length > 0) {
      return asErrorPayload('URL_MISMATCH', 'current url validation failed', {
        url,
        includes,
        excludes,
        missing,
        forbidden,
      });
    }
    return { ok: true, code: 'OPERATION_DONE', message: 'get_current_url done', data: { url } };
  }

  if (action === 'sync_window_viewport') {
    const rawWidth = Number(params.width ?? params.viewportWidth);
    const rawHeight = Number(params.height ?? params.viewportHeight);
    const hasTargetViewport = Number.isFinite(rawWidth) && Number.isFinite(rawHeight);
    const width = hasTargetViewport ? Math.max(320, rawWidth) : null;
    const height = hasTargetViewport ? Math.max(240, rawHeight) : null;
    const followWindow = params.followWindow !== false;
    const settleMs = Math.max(0, Number(params.settleMs ?? 180) || 180);
    const attempts = Math.max(1, Number(params.attempts ?? 3) || 3);
    const tolerance = Math.max(0, Number(params.tolerancePx ?? 3) || 3);
    const apiTimeoutMs = Math.max(1000, Number(params.apiTimeoutMs ?? 8000) || 8000);

    const probeWindow = async () => {
      const probe = await callWithTimeout('evaluate', {
        profileId,
        script: '({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight })',
      }, apiTimeoutMs);
      return probe?.result || {};
    };

    let measured = await probeWindow();
    if (followWindow && !hasTargetViewport) {
      const innerWidth = Math.max(320, Number(measured.innerWidth || 0) || 1280);
      const innerHeight = Math.max(240, Number(measured.innerHeight || 0) || 720);
      const outerWidth = Math.max(320, Number(measured.outerWidth || 0) || innerWidth);
      const outerHeight = Math.max(240, Number(measured.outerHeight || 0) || innerHeight);
      const rawDeltaW = Math.max(0, outerWidth - innerWidth);
      const rawDeltaH = Math.max(0, outerHeight - innerHeight);
      const frameW = rawDeltaW > 400 ? 16 : Math.min(rawDeltaW, 120);
      const frameH = rawDeltaH > 400 ? 88 : Math.min(rawDeltaH, 180);
      const followWidth = Math.max(320, outerWidth - frameW);
      const followHeight = Math.max(240, outerHeight - frameH);

      await callWithTimeout('page:setViewport', { profileId, width: followWidth, height: followHeight }, apiTimeoutMs);
      const synced = await probeWindow();
      return {
        ok: true,
        code: 'OPERATION_DONE',
        message: 'sync_window_viewport follow window done',
        data: {
          followWindow: true,
          viewport: { width: followWidth, height: followHeight },
          frame: { width: frameW, height: frameH },
          measured: synced,
        },
      };
    }

    if (!hasTargetViewport) {
      return asErrorPayload('OPERATION_FAILED', 'sync_window_viewport requires width/height when followWindow=false');
    }

    await callWithTimeout('page:setViewport', { profileId, width, height }, apiTimeoutMs);

    for (let i = 0; i < attempts; i += 1) {
      measured = await probeWindow();
      const innerWidth = Number(measured.innerWidth || 0);
      const innerHeight = Number(measured.innerHeight || 0);
      const widthOk = Math.abs(innerWidth - width) <= tolerance;
      const heightOk = Math.abs(innerHeight - height) <= tolerance;
      if (widthOk && heightOk) {
        return {
          ok: true,
          code: 'OPERATION_DONE',
          message: 'sync_window_viewport done',
          data: {
            width,
            height,
            followWindow,
            attempts: i + 1,
            measured,
            matched: true,
          },
        };
      }

      const outerWidth = Number(measured.outerWidth || 0);
      const outerHeight = Number(measured.outerHeight || 0);
      const targetWindowWidth = Math.max(width + 16, outerWidth + (width - innerWidth));
      const targetWindowHeight = Math.max(height + 80, outerHeight + (height - innerHeight));
      await callWithTimeout('window:resize', {
        profileId,
        width: Math.round(targetWindowWidth),
        height: Math.round(targetWindowHeight),
      }, apiTimeoutMs);
      if (settleMs > 0) await new Promise((resolve) => setTimeout(resolve, settleMs));
      await callWithTimeout('page:setViewport', { profileId, width, height }, apiTimeoutMs);
    }

    return {
      ok: true,
      code: 'OPERATION_DONE',
      message: 'sync_window_viewport best effort done',
      data: {
        width,
        height,
        followWindow,
        attempts,
        measured,
        matched: Math.abs(Number(measured.innerWidth || 0) - width) <= tolerance
          && Math.abs(Number(measured.innerHeight || 0) - height) <= tolerance,
      },
    };
  }

  return asErrorPayload('UNSUPPORTED_OPERATION', `Unsupported viewport operation: ${action}`);
}
