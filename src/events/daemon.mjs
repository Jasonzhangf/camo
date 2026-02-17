import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_HOST = process.env.CAMO_PROGRESS_WS_HOST || '127.0.0.1';
const DEFAULT_PORT = Math.max(1, Number(process.env.CAMO_PROGRESS_WS_PORT || 7788) || 7788);
const DEFAULT_HEALTH_TIMEOUT_MS = 800;
const DEFAULT_START_TIMEOUT_MS = 4000;
const HEALTH_POLL_INTERVAL_MS = 140;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveProgressWsConfig(options = {}) {
  const host = String(options.host || DEFAULT_HOST).trim() || DEFAULT_HOST;
  const port = Math.max(1, Number(options.port || DEFAULT_PORT) || DEFAULT_PORT);
  return { host, port };
}

export function buildProgressHealthUrl(options = {}) {
  const { host, port } = resolveProgressWsConfig(options);
  return `http://${host}:${port}/health`;
}

export async function checkProgressEventDaemon(options = {}) {
  const timeoutMs = Math.max(150, Number(options.timeoutMs || DEFAULT_HEALTH_TIMEOUT_MS) || DEFAULT_HEALTH_TIMEOUT_MS);
  const healthUrl = buildProgressHealthUrl(options);
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return false;
    const body = await response.json().catch(() => null);
    return Boolean(body?.ok);
  } catch {
    return false;
  }
}

function getDaemonEntryPath() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return path.join(dir, 'daemon-entry.mjs');
}

function spawnProgressDaemon({ host, port }) {
  const entry = getDaemonEntryPath();
  const child = spawn(
    process.execPath,
    [entry, '--host', host, '--port', String(port)],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        CAMO_PROGRESS_DAEMON: '1',
      },
    },
  );
  child.unref();
}

export async function ensureProgressEventDaemon(options = {}) {
  const { host, port } = resolveProgressWsConfig(options);
  const startTimeoutMs = Math.max(400, Number(options.startTimeoutMs || DEFAULT_START_TIMEOUT_MS) || DEFAULT_START_TIMEOUT_MS);
  if (await checkProgressEventDaemon({ host, port })) {
    return { ok: true, started: false, host, port };
  }

  spawnProgressDaemon({ host, port });

  const deadline = Date.now() + startTimeoutMs;
  while (Date.now() < deadline) {
    if (await checkProgressEventDaemon({ host, port })) {
      return { ok: true, started: true, host, port };
    }
    await sleep(HEALTH_POLL_INTERVAL_MS);
  }

  return { ok: false, started: true, host, port, error: 'progress_daemon_start_timeout' };
}

