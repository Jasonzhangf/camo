import { getDefaultProfile, setProfileWindowSize } from '../utils/config.mjs';
import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';
import { getPositionals } from '../utils/args.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeTargetViewport(measured) {
  const innerWidth = Math.max(320, Number(measured?.innerWidth || 0) || 0);
  const innerHeight = Math.max(240, Number(measured?.innerHeight || 0) || 0);
  const outerWidth = Math.max(320, Number(measured?.outerWidth || 0) || innerWidth);
  const outerHeight = Math.max(240, Number(measured?.outerHeight || 0) || innerHeight);

  const rawDeltaW = Math.max(0, outerWidth - innerWidth);
  const rawDeltaH = Math.max(0, outerHeight - innerHeight);
  const frameW = rawDeltaW > 400 ? 16 : Math.min(rawDeltaW, 120);
  const frameH = rawDeltaH > 400 ? 88 : Math.min(rawDeltaH, 180);

  return {
    width: Math.max(320, outerWidth - frameW),
    height: Math.max(240, outerHeight - frameH),
    frameW,
    frameH,
  };
}

async function probeWindowMetrics(profileId) {
  const measured = await callAPI('evaluate', {
    profileId,
    script: '({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, outerWidth: window.outerWidth, outerHeight: window.outerHeight })',
  });
  return measured?.result || {};
}

export async function handleWindowCommand(args) {
  await ensureBrowserService();

  const sub = args[1];
  const profileId = getPositionals(args, 2)[0] || getDefaultProfile();
  if (!profileId) throw new Error('No profile specified and no default profile set');

  if (sub === 'move') {
    const xIdx = args.indexOf('--x');
    const yIdx = args.indexOf('--y');
    if (xIdx === -1 || yIdx === -1) throw new Error('Usage: camo window move [profileId] --x <x> --y <y>');
    const x = parseInt(args[xIdx + 1]);
    const y = parseInt(args[yIdx + 1]);
    const result = await callAPI('window:move', { profileId, x, y });
    console.log(JSON.stringify(result, null, 2));
  } else if (sub === 'resize') {
    const widthIdx = args.indexOf('--width');
    const heightIdx = args.indexOf('--height');
    if (widthIdx === -1 || heightIdx === -1) throw new Error('Usage: camo window resize [profileId] --width <w> --height <h>');
    const width = parseInt(args[widthIdx + 1]);
    const height = parseInt(args[heightIdx + 1]);
    const result = await callAPI('window:resize', { profileId, width, height });

    const attempts = 4;
    const settleMs = 120;
    const tolerancePx = 3;
    let measured = {};
    let verified = {};
    let viewport = null;
    let targetViewportWidth = 1280;
    let targetViewportHeight = 720;
    let frameW = 16;
    let frameH = 88;
    let matched = false;

    await sleep(settleMs);
    for (let i = 0; i < attempts; i += 1) {
      measured = await probeWindowMetrics(profileId);
      const target = computeTargetViewport(measured);
      targetViewportWidth = target.width;
      targetViewportHeight = target.height;
      frameW = target.frameW;
      frameH = target.frameH;

      viewport = await callAPI('page:setViewport', {
        profileId,
        width: targetViewportWidth,
        height: targetViewportHeight,
      });

      await sleep(settleMs);
      verified = await probeWindowMetrics(profileId);
      const dw = Math.abs((Number(verified?.innerWidth || 0)) - targetViewportWidth);
      const dh = Math.abs((Number(verified?.innerHeight || 0)) - targetViewportHeight);
      if (dw <= tolerancePx && dh <= tolerancePx) {
        matched = true;
        break;
      }
    }

    const measuredOuterWidth = Number(verified?.outerWidth);
    const measuredOuterHeight = Number(verified?.outerHeight);
    const savedWindow = setProfileWindowSize(
      profileId,
      Number.isFinite(measuredOuterWidth) ? measuredOuterWidth : width,
      Number.isFinite(measuredOuterHeight) ? measuredOuterHeight : height,
    );

    console.log(JSON.stringify({
      ok: true,
      profileId,
      window: result,
      measured: measured || null,
      verified: verified || null,
      targetViewport: {
        width: targetViewportWidth,
        height: targetViewportHeight,
        frameW,
        frameH,
        matched,
      },
      profileWindow: savedWindow?.window || null,
      viewport,
    }, null, 2));
  } else {
    throw new Error('Usage: camo window <move|resize> [profileId] --x <x> --y <y> / --width <w> --height <h>');
  }
}
