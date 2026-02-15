import { getDefaultProfile } from '../utils/config.mjs';
import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';
import { getPositionals } from '../utils/args.mjs';

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
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Usage: camo window <move|resize> [profileId] --x <x> --y <y> / --width <w> --height <h>');
  }
}
