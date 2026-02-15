import { getDefaultProfile } from '../utils/config.mjs';
import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';
import { getPositionals } from '../utils/args.mjs';

export async function handleCookiesCommand(args) {
  await ensureBrowserService();

  const sub = args[1];
  const profileId = getPositionals(args, 2)[0] || getDefaultProfile();
  if (!profileId) throw new Error('No profile specified and no default profile set');

  switch (sub) {
    case 'get':
      await handleGetCookies(profileId);
      break;
    case 'save':
      await handleSaveCookies(profileId, args);
      break;
    case 'load':
      await handleLoadCookies(profileId, args);
      break;
    case 'auto':
      await handleAutoCookies(profileId, args);
      break;
    default:
      throw new Error('Usage: camo cookies <get|save|load|auto> [profileId] [--path <path>] [--interval <ms>]');
  }
}

async function handleGetCookies(profileId) {
  const result = await callAPI('getCookies', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

async function handleSaveCookies(profileId, args) {
  const pathIdx = args.indexOf('--path');
  if (pathIdx === -1) throw new Error('--path <file> is required for save');
  const cookiePath = args[pathIdx + 1];
  const result = await callAPI('saveCookies', { profileId, path: cookiePath });
  console.log(JSON.stringify(result, null, 2));
}

async function handleLoadCookies(profileId, args) {
  const pathIdx = args.indexOf('--path');
  if (pathIdx === -1) throw new Error('--path <file> is required for load');
  const cookiePath = args[pathIdx + 1];
  const result = await callAPI('loadCookies', { profileId, path: cookiePath });
  console.log(JSON.stringify(result, null, 2));
}

async function handleAutoCookies(profileId, args) {
  const action = args[2];
  if (!action) throw new Error('Usage: camo cookies auto <start|stop|status> [profileId] [--interval <ms>]');

  if (action === 'start') {
    const intervalIdx = args.indexOf('--interval');
    const intervalMs = intervalIdx >= 0 ? parseInt(args[intervalIdx + 1]) : 2500;
    const result = await callAPI('autoCookies:start', { profileId, intervalMs });
    console.log(JSON.stringify(result, null, 2));
  } else if (action === 'stop') {
    const result = await callAPI('autoCookies:stop', { profileId });
    console.log(JSON.stringify(result, null, 2));
  } else if (action === 'status') {
    const result = await callAPI('autoCookies:status', { profileId });
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('auto subcommand must be start, stop, or status');
  }
}
