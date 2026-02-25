import { getDefaultProfile } from '../utils/config.mjs';
import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';
import { getPositionals } from '../utils/args.mjs';

const INPUT_ACTION_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.CAMO_INPUT_ACTION_TIMEOUT_MS);
  if (!Number.isFinite(parsed) || parsed <= 0) return 30000;
  return Math.max(1000, Math.floor(parsed));
})();

export async function handleMouseCommand(args) {
  await ensureBrowserService();

  const sub = args[1];
  const profileId = getPositionals(args, 2)[0] || getDefaultProfile();
  if (!profileId) throw new Error('No profile specified and no default profile set');

  if (sub === 'move') {
    const xIdx = args.indexOf('--x');
    const yIdx = args.indexOf('--y');
    const stepsIdx = args.indexOf('--steps');
    if (xIdx === -1 || yIdx === -1) throw new Error('Usage: camo mouse move [profileId] --x <x> --y <y> [--steps <n>]');
    const x = parseInt(args[xIdx + 1]);
    const y = parseInt(args[yIdx + 1]);
    const steps = stepsIdx >= 0 ? parseInt(args[stepsIdx + 1]) : undefined;
    const result = await callAPI('mouse:move', { profileId, x, y, steps }, { timeoutMs: INPUT_ACTION_TIMEOUT_MS });
    console.log(JSON.stringify(result, null, 2));
  } else if (sub === 'click') {
    // Use existing click command? We already have click command for element clicking.
    // This is for raw mouse click at coordinates.
    const xIdx = args.indexOf('--x');
    const yIdx = args.indexOf('--y');
    const buttonIdx = args.indexOf('--button');
    const clicksIdx = args.indexOf('--clicks');
    const delayIdx = args.indexOf('--delay');
    if (xIdx === -1 || yIdx === -1) throw new Error('Usage: camo mouse click [profileId] --x <x> --y <y> [--button left|right|middle] [--clicks <n>] [--delay <ms>]');
    const x = parseInt(args[xIdx + 1]);
    const y = parseInt(args[yIdx + 1]);
    const button = buttonIdx >= 0 ? args[buttonIdx + 1] : 'left';
    const clicks = clicksIdx >= 0 ? parseInt(args[clicksIdx + 1]) : 1;
    const delay = delayIdx >= 0 ? parseInt(args[delayIdx + 1]) : undefined;
    const result = await callAPI('mouse:click', { profileId, x, y, button, clicks, delay }, { timeoutMs: INPUT_ACTION_TIMEOUT_MS });
    console.log(JSON.stringify(result, null, 2));
  } else if (sub === 'wheel') {
    const deltaXIdx = args.indexOf('--deltax');
    const deltaYIdx = args.indexOf('--deltay');
    if (deltaXIdx === -1 && deltaYIdx === -1) throw new Error('Usage: camo mouse wheel [profileId] [--deltax <px>] [--deltay <px>]');
    const deltaX = deltaXIdx >= 0 ? parseInt(args[deltaXIdx + 1]) : 0;
    const deltaY = deltaYIdx >= 0 ? parseInt(args[deltaYIdx + 1]) : 0;
    const result = await callAPI('mouse:wheel', { profileId, deltaX, deltaY }, { timeoutMs: INPUT_ACTION_TIMEOUT_MS });
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Usage: camo mouse <move|click|wheel> [profileId] [options]');
  }
}
