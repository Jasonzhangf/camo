import fs from 'node:fs';
import path from 'node:path';
import { listProfiles, getDefaultProfile, hasStartScript } from '../utils/config.mjs';
import { callAPI, ensureCamoufox, ensureBrowserService, getSessionByProfile } from '../utils/browser-service.mjs';
import { resolveProfileId, ensureUrlScheme, looksLikeUrlToken, getPositionals } from '../utils/args.mjs';

export async function handleStartCommand(args) {
  ensureCamoufox();
  await ensureBrowserService();

  const urlIdx = args.indexOf('--url');
  const explicitUrl = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const profileSet = new Set(listProfiles());
  let implicitUrl;
  
  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url') { i++; continue; }
    if (arg === '--headless') continue;
    if (arg.startsWith('--')) continue;

    if (looksLikeUrlToken(arg) && !profileSet.has(arg)) {
      implicitUrl = arg;
      continue;
    }

    profileId = arg;
    break;
  }
  
  if (!profileId) {
    profileId = getDefaultProfile();
    if (!profileId) {
      throw new Error('No default profile set. Run: camo profile default <profileId>');
    }
  }

  const existing = await getSessionByProfile(profileId);
  if (existing) {
    console.log(JSON.stringify({
      ok: true,
      sessionId: existing.session_id || existing.profileId,
      profileId,
      message: 'Session already running',
      url: existing.current_url,
    }, null, 2));
    return;
  }

  const headless = args.includes('--headless');
  const targetUrl = explicitUrl || implicitUrl;
  const result = await callAPI('start', {
    profileId,
    url: targetUrl ? ensureUrlScheme(targetUrl) : undefined,
    headless,
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleStopCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo stop [profileId]');
  const result = await callAPI('stop', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleStatusCommand(args) {
  await ensureBrowserService();
  const result = await callAPI('getStatus', {});
  const profileId = args[1];
  if (profileId && args[0] === 'status') {
    const session = result?.sessions?.find((s) => s.profileId === profileId) || null;
    console.log(JSON.stringify({ ok: true, session }, null, 2));
    return;
  }
  console.log(JSON.stringify(result, null, 2));
}

export async function handleGotoCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);

  let profileId;
  let url;

  if (positionals.length === 1) {
    profileId = getDefaultProfile();
    url = positionals[0];
  } else {
    profileId = resolveProfileId(positionals, 0, getDefaultProfile);
    url = positionals[1];
  }

  if (!profileId) throw new Error('Usage: camo goto [profileId] <url> (or set default profile first)');
  if (!url) throw new Error('Usage: camo goto [profileId] <url>');
  const result = await callAPI('goto', { profileId, url: ensureUrlScheme(url) });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleBackCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo back [profileId] (or set default profile first)');
  const result = await callAPI('page:back', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleScreenshotCommand(args) {
  await ensureBrowserService();
  const fullPage = args.includes('--full');
  const outputIdx = args.indexOf('--output');
  const output = outputIdx >= 0 ? args[outputIdx + 1] : null;
  
  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--full') continue;
    if (arg === '--output') { i++; continue; }
    if (arg.startsWith('--')) continue;
    profileId = arg;
    break;
  }
  
  if (!profileId) profileId = getDefaultProfile();
  if (!profileId) throw new Error('Usage: camo screenshot [profileId] [--output <file>] [--full]');
  
  const result = await callAPI('screenshot', { profileId, fullPage });

  if (output && result?.data) {
    fs.writeFileSync(output, Buffer.from(result.data, 'base64'));
    console.log(`Screenshot saved to ${output}`);
    return;
  }

  console.log(JSON.stringify(result, null, 2));
}

export async function handleScrollCommand(args) {
  await ensureBrowserService();
  const directionFlags = new Set(['--up', '--down', '--left', '--right']);
  const isFlag = (arg) => arg?.startsWith('--');

  let profileId = null;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (directionFlags.has(arg)) continue;
    if (arg === '--amount') { i++; continue; }
    if (isFlag(arg)) continue;
    profileId = arg;
    break;
  }
  if (!profileId) profileId = getDefaultProfile();
  if (!profileId) throw new Error('Usage: camo scroll [profileId] [--down|--up|--left|--right] [--amount <px>]');

  const direction = args.includes('--up') ? 'up' : args.includes('--left') ? 'left' : args.includes('--right') ? 'right' : 'down';
  const amountIdx = args.indexOf('--amount');
  const amount = amountIdx >= 0 ? Number(args[amountIdx + 1]) || 300 : 300;

  const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;
  const result = await callAPI('mouse:wheel', { profileId, deltaX, deltaY });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleClickCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);
  let profileId;
  let selector;

  if (positionals.length === 1) {
    profileId = getDefaultProfile();
    selector = positionals[0];
  } else {
    profileId = positionals[0];
    selector = positionals[1];
  }

  if (!profileId) throw new Error('Usage: camo click [profileId] <selector>');
  if (!selector) throw new Error('Usage: camo click [profileId] <selector>');

  const result = await callAPI('evaluate', {
    profileId,
    script: `(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 200));
      el.click();
      return { clicked: true, selector: ${JSON.stringify(selector)} };
    })()`
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleTypeCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);
  let profileId;
  let selector;
  let text;

  if (positionals.length === 2) {
    profileId = getDefaultProfile();
    selector = positionals[0];
    text = positionals[1];
  } else {
    profileId = positionals[0];
    selector = positionals[1];
    text = positionals[2];
  }

  if (!profileId) throw new Error('Usage: camo type [profileId] <selector> <text>');
  if (!selector || text === undefined) throw new Error('Usage: camo type [profileId] <selector> <text>');

  const result = await callAPI('evaluate', {
    profileId,
    script: `(async () => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await new Promise(r => setTimeout(r, 200));
      el.focus();
      el.value = '';
      el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { typed: true, selector: ${JSON.stringify(selector)}, length: ${text.length} };
    })()`
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleHighlightCommand(args) {
  await ensureBrowserService();
  const positionals = getPositionals(args);
  let profileId;
  let selector;

  if (positionals.length === 1) {
    profileId = getDefaultProfile();
    selector = positionals[0];
  } else {
    profileId = positionals[0];
    selector = positionals[1];
  }

  if (!profileId) throw new Error('Usage: camo highlight [profileId] <selector>');
  if (!selector) throw new Error('Usage: camo highlight [profileId] <selector>');

  const result = await callAPI('evaluate', {
    profileId,
    script: `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
      const prev = el.style.outline;
      el.style.outline = '3px solid #ff4444';
      setTimeout(() => { el.style.outline = prev; }, 2000);
      const rect = el.getBoundingClientRect();
      return { highlighted: true, selector: ${JSON.stringify(selector)}, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    })()`
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleClearHighlightCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo clear-highlight [profileId]');

  const result = await callAPI('evaluate', {
    profileId,
    script: `(() => {
      const overlay = document.getElementById('webauto-highlight-overlay');
      if (overlay) overlay.remove();
      document.querySelectorAll('[data-webauto-highlight]').forEach(el => {
        el.style.outline = el.dataset.webautoHighlight || '';
        delete el.dataset.webautoHighlight;
      });
      return { cleared: true };
    })()`
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleViewportCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo viewport [profileId] --width <w> --height <h>');

  const widthIdx = args.indexOf('--width');
  const heightIdx = args.indexOf('--height');
  const width = widthIdx >= 0 ? Number(args[widthIdx + 1]) : 1280;
  const height = heightIdx >= 0 ? Number(args[heightIdx + 1]) : 800;

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Usage: camo viewport [profileId] --width <w> --height <h>');
  }

  const result = await callAPI('page:setViewport', { profileId, width, height });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleNewPageCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo new-page [profileId] [--url <url>] (or set default profile first)');
  const urlIdx = args.indexOf('--url');
  const url = urlIdx >= 0 ? args[urlIdx + 1] : undefined;
  const result = await callAPI('newPage', { profileId, ...(url ? { url: ensureUrlScheme(url) } : {}) });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleClosePageCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo close-page [profileId] [index] (or set default profile first)');
  
  let index;
  for (let i = args.length - 1; i >= 1; i--) {
    const arg = args[i];
    if (arg.startsWith('--')) continue;
    const num = Number(arg);
    if (Number.isFinite(num)) { index = num; break; }
  }
  
  const result = await callAPI('page:close', { profileId, ...(Number.isFinite(index) ? { index } : {}) });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleSwitchPageCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo switch-page [profileId] <index> (or set default profile first)');
  
  let index;
  for (let i = args.length - 1; i >= 1; i--) {
    const arg = args[i];
    if (arg.startsWith('--')) continue;
    const num = Number(arg);
    if (Number.isFinite(num)) { index = num; break; }
  }
  
  if (!Number.isFinite(index)) throw new Error('Usage: camo switch-page [profileId] <index>');
  const result = await callAPI('page:switch', { profileId, index });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleListPagesCommand(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  if (!profileId) throw new Error('Usage: camo list-pages [profileId] (or set default profile first)');
  const result = await callAPI('page:list', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleShutdownCommand() {
  await ensureBrowserService();
  const result = await callAPI('service:shutdown', {});
  console.log(JSON.stringify(result, null, 2));
}
