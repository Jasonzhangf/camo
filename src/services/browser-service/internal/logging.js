import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, ensureDir } from '../../../utils/config.mjs';

const LOG_DIR = String(process.env.CAMO_LOG_DIR || '').trim() || path.join(CONFIG_DIR, 'logs');
const DEBUG_LOG_FILE = path.join(LOG_DIR, 'debug.jsonl');
let debugReady = false;

function isDebugEnabled() {
  return (
    process.env.DEBUG === '1'
    || process.env.debug === '1'
    || process.env.CAMO_DEBUG === '1'
    || process.env.CAMO_DEBUG === '1'
    || process.env.CAMO_DEBUG === '1'
  );
}

function ensureDebugLogDir() {
  if (debugReady) return;
  try {
    ensureDir(LOG_DIR);
    debugReady = true;
  } catch {
    // ignore
  }
}

export function logDebug(module, event, data = {}) {
  if (!isDebugEnabled()) return;
  ensureDebugLogDir();
  const entry = {
    ts: Date.now(),
    level: 'debug',
    module,
    event,
    data,
  };
  try {
    fs.appendFileSync(DEBUG_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // ignore
  }
}

export { DEBUG_LOG_FILE };
