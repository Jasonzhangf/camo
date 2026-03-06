import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, ensureDir } from '../../../utils/config.mjs';

function resolveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function resolveHeartbeatFile(filePath) {
  const explicit = String(filePath || '').trim();
  if (explicit) return explicit;
  const envPath = String(process.env.CAMO_HEARTBEAT_FILE || '').trim();
  if (envPath) return envPath;
  return path.join(CONFIG_DIR, 'run', 'camo-heartbeat.json');
}

function readHeartbeat(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return {
      ts: typeof data.ts === 'string' ? data.ts : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
    };
  } catch {
    return null;
  }
}

export function startHeartbeatWriter(options = {}) {
  const filePath = resolveHeartbeatFile(options.filePath);
  const intervalMs = resolveNumber(
    options.intervalMs ?? process.env.CAMO_HEARTBEAT_INTERVAL_MS,
    5000,
  );
  const staleMs = resolveNumber(
    options.staleMs ?? process.env.CAMO_HEARTBEAT_STALE_MS,
    45000,
  );
  let status = String(options.initialStatus || 'running');

  process.env.CAMO_HEARTBEAT_FILE = filePath;
  process.env.CAMO_HEARTBEAT_INTERVAL_MS = String(intervalMs);
  process.env.CAMO_HEARTBEAT_STALE_MS = String(staleMs);

  try {
    ensureDir(path.dirname(filePath));
  } catch {
    // ignore
  }

  const write = (nextStatus) => {
    if (nextStatus) status = String(nextStatus);
    const payload = {
      pid: process.pid,
      ts: new Date().toISOString(),
      status,
    };
    try {
      fs.writeFileSync(filePath, JSON.stringify(payload));
    } catch {
      // ignore
    }
  };

  write(status);
  const timer = setInterval(() => write(), intervalMs);
  timer.unref();

  const stop = () => {
    write('stopped');
    clearInterval(timer);
  };

  process.on('exit', stop);
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const setStatus = (nextStatus) => {
    write(nextStatus || 'running');
  };

  return { stop, filePath, intervalMs, staleMs, setStatus };
}

export function startHeartbeatWatcher(options = {}) {
  const filePath = options.filePath || process.env.CAMO_HEARTBEAT_FILE;
  if (!filePath) return () => {};

  const staleMs = resolveNumber(options.staleMs ?? process.env.CAMO_HEARTBEAT_STALE_MS, 45000);
  const intervalMs = resolveNumber(options.intervalMs ?? process.env.CAMO_HEARTBEAT_INTERVAL_MS, Math.max(2000, Math.floor(staleMs / 3)));
  const serviceName = options.serviceName || 'service';
  const startAt = Date.now();

  const timer = setInterval(() => {
    let ts = 0;
    let status = '';

    const payload = readHeartbeat(filePath);
    if (payload) {
      status = String(payload.status || '');
      ts = payload.ts ? Date.parse(payload.ts) : 0;
    }

    if (!ts) {
      try {
        const stat = fs.statSync(filePath);
        ts = Number(stat.mtimeMs || 0);
      } catch (err) {
        if (err?.code === 'ENOENT') {
          if (Date.now() - startAt > staleMs) {
            console.warn(`[heartbeat] ${serviceName} exit: heartbeat file missing (${filePath})`);
            process.exit(0);
          }
        }
        return;
      }
    }

    if (status === 'stopped') {
      console.warn(`[heartbeat] ${serviceName} exit: main process stopped`);
      process.exit(0);
    }

    const age = Date.now() - ts;
    if (age > staleMs) {
      console.warn(`[heartbeat] ${serviceName} exit: heartbeat stale ${age}ms > ${staleMs}ms`);
      process.exit(0);
    }
  }, intervalMs);

  timer.unref();
  return () => clearInterval(timer);
}
