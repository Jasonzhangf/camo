import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, ensureDir } from './config.mjs';

export const COMMAND_LOG_DIR = path.join(CONFIG_DIR, 'logs');
export const COMMAND_LOG_FILE = path.join(COMMAND_LOG_DIR, 'command-log.jsonl');

function safeSerialize(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return { text: String(value) };
  }
}

function normalizeMeta(meta = {}) {
  const sender = meta?.sender && typeof meta.sender === 'object' ? meta.sender : {};
  return {
    source: String(meta?.source || '').trim() || 'unknown',
    cwd: String(meta?.cwd || sender?.cwd || '').trim() || process.cwd(),
    pid: Number(meta?.pid || sender?.pid || process.pid) || process.pid,
    ppid: Number(meta?.ppid || sender?.ppid || process.ppid) || process.ppid,
    argv: Array.isArray(meta?.argv) ? meta.argv.map((item) => String(item)) : undefined,
    sender: {
      source: String(sender?.source || meta?.source || '').trim() || 'unknown',
      cwd: String(sender?.cwd || meta?.cwd || '').trim() || process.cwd(),
      pid: Number(sender?.pid || meta?.pid || process.pid) || process.pid,
      ppid: Number(sender?.ppid || meta?.ppid || process.ppid) || process.ppid,
      argv: Array.isArray(sender?.argv) ? sender.argv.map((item) => String(item)) : undefined,
    },
  };
}

export function appendCommandLog(entry = {}) {
  try {
    ensureDir(COMMAND_LOG_DIR);
    const meta = normalizeMeta(entry?.meta || {});
    const line = {
      ts: new Date().toISOString(),
      action: String(entry?.action || '').trim() || null,
      profileId: String(entry?.profileId || '').trim() || null,
      command: String(entry?.command || '').trim() || null,
      args: Array.isArray(entry?.args) ? entry.args.map((item) => String(item)) : undefined,
      payload: safeSerialize(entry?.payload),
      meta,
    };
    fs.appendFileSync(COMMAND_LOG_FILE, `${JSON.stringify(line)}\n`, 'utf8');
    return line;
  } catch {
    return null;
  }
}

export function buildCommandSenderMeta(overrides = {}) {
  return {
    source: String(overrides?.source || '').trim() || 'unknown',
    cwd: String(overrides?.cwd || '').trim() || process.cwd(),
    pid: Number(overrides?.pid || process.pid) || process.pid,
    ppid: Number(overrides?.ppid || process.ppid) || process.ppid,
    argv: Array.isArray(overrides?.argv) ? overrides.argv.map((item) => String(item)) : process.argv.slice(),
  };
}
