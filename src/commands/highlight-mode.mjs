import { getHighlightMode, setHighlightMode } from '../utils/config.mjs';

export async function handleHighlightModeCommand(args) {
  const sub = String(args[1] || 'status').trim().toLowerCase();

  if (sub === 'status') {
    console.log(JSON.stringify({ ok: true, highlightMode: getHighlightMode() }, null, 2));
    return;
  }

  if (sub === 'on' || sub === 'enable') {
    const next = setHighlightMode(true);
    console.log(JSON.stringify({ ok: true, highlightMode: next }, null, 2));
    return;
  }

  if (sub === 'off' || sub === 'disable') {
    const next = setHighlightMode(false);
    console.log(JSON.stringify({ ok: true, highlightMode: next }, null, 2));
    return;
  }

  throw new Error('Usage: camo highlight-mode [status|on|off]');
}
