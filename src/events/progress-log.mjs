import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, ensureDir } from '../utils/config.mjs';

const DEFAULT_EVENTS_DIR = path.join(CONFIG_DIR, 'run', 'events');
const DEFAULT_EVENTS_FILE = path.join(DEFAULT_EVENTS_DIR, 'progress-events.jsonl');
const MAX_REPLAY_BYTES = Math.max(64 * 1024, Number(process.env.CAMO_PROGRESS_REPLAY_MAX_BYTES) || (2 * 1024 * 1024));

let localSeq = 0;

function resolveEventsFile() {
  const raw = String(process.env.CAMO_PROGRESS_EVENTS_FILE || DEFAULT_EVENTS_FILE).trim();
  return raw || DEFAULT_EVENTS_FILE;
}

function nextSeq() {
  localSeq = (localSeq + 1) % 1_000_000_000;
  return `${Date.now()}-${process.pid}-${localSeq}`;
}

function normalizePayload(payload) {
  if (payload === undefined) return null;
  if (payload === null) return null;
  if (typeof payload === 'object') return payload;
  return { value: payload };
}

export function getProgressEventsFile() {
  return resolveEventsFile();
}

export function ensureProgressEventStore() {
  const eventFile = resolveEventsFile();
  ensureDir(path.dirname(eventFile));
  if (!fs.existsSync(eventFile)) {
    fs.writeFileSync(eventFile, '', 'utf8');
  }
  return eventFile;
}

export function buildProgressEvent({
  ts = null,
  seq = null,
  source = 'camo',
  mode = 'normal',
  profileId = null,
  runId = null,
  event = 'unknown',
  payload = null,
} = {}) {
  return {
    ts: ts || new Date().toISOString(),
    seq: seq || nextSeq(),
    source: String(source || 'camo'),
    mode: String(mode || 'normal'),
    profileId: profileId ? String(profileId) : null,
    runId: runId ? String(runId) : null,
    event: String(event || 'unknown'),
    payload: normalizePayload(payload),
  };
}

export function appendProgressEvent(input = {}) {
  const eventFile = ensureProgressEventStore();
  const event = buildProgressEvent(input);
  fs.appendFileSync(eventFile, `${JSON.stringify(event)}\n`, 'utf8');
  return event;
}

export function safeAppendProgressEvent(input = {}) {
  try {
    return appendProgressEvent(input);
  } catch {
    return null;
  }
}

export function readRecentProgressEvents(limit = 100) {
  const eventFile = ensureProgressEventStore();
  const maxItems = Math.max(0, Number(limit) || 0);
  if (maxItems === 0) return [];
  const stat = fs.statSync(eventFile);
  if (stat.size <= 0) return [];

  const start = Math.max(0, stat.size - MAX_REPLAY_BYTES);
  const fd = fs.openSync(eventFile, 'r');
  try {
    const length = stat.size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const raw = buffer.toString('utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-maxItems)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

