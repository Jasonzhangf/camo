import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR, ensureDir } from '../../../utils/config.mjs';

const LOG_DIR = String(process.env.CAMO_LOG_DIR || '').trim() || path.join(CONFIG_DIR, 'logs');
const INSTALLED = new Set();

function safeAppend(filePath, line) {
  try {
    fs.appendFileSync(filePath, line, 'utf8');
  } catch {
    // ignore
  }
}

function formatError(err) {
  if (!err || typeof err !== 'object') return { message: String(err) };
  const anyErr = err;
  return {
    name: typeof anyErr.name === 'string' ? anyErr.name : undefined,
    message: typeof anyErr.message === 'string' ? anyErr.message : String(err),
    stack: typeof anyErr.stack === 'string' ? anyErr.stack : undefined,
    code: typeof anyErr.code === 'string' ? anyErr.code : undefined,
  };
}

function createConsoleTee(logFile) {
  const kWrapped = Symbol.for('camo.consoleTeeWrapped');
  const g = globalThis;
  if (g[kWrapped]) return;
  g[kWrapped] = true;

  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const wrap = (level) => {
    return (...args) => {
      const ts = new Date().toISOString();
      const msg = args
        .map((a) => {
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ');
      safeAppend(logFile, `[${ts}] [${String(level).toUpperCase()}] ${msg}\n`);
      originals[level](...args);
    };
  };

  console.log = wrap('log');
  console.info = wrap('info');
  console.warn = wrap('warn');
  console.error = wrap('error');
}

export function installServiceProcessLogger(opts = {}) {
  const serviceName = String(opts.serviceName || '').trim();
  const id = `service:${serviceName}`;
  if (!serviceName) return { logEvent: () => {} };
  if (INSTALLED.has(id)) return { logEvent: () => {} };
  INSTALLED.add(id);

  ensureDir(LOG_DIR);
  const crashFile = path.join(LOG_DIR, `${serviceName}.crash.jsonl`);
  const consoleLogFile = path.join(LOG_DIR, `${serviceName}.log`);

  const tee = typeof opts.teeConsoleToFile === 'boolean'
    ? opts.teeConsoleToFile
    : !!(process.stdout.isTTY || process.stderr.isTTY);
  if (tee) createConsoleTee(consoleLogFile);

  const base = {
    service: serviceName,
    pid: process.pid,
    node: process.version,
  };

  const logEvent = (event, data = {}) => {
    safeAppend(
      crashFile,
      `${JSON.stringify({
        ts: new Date().toISOString(),
        ...base,
        event,
        ...data,
      })}\n`,
    );
  };

  logEvent('process_start', {
    argv: process.argv,
    cwd: process.cwd(),
    ppid: process.ppid,
    stdoutIsTTY: !!process.stdout.isTTY,
    stderrIsTTY: !!process.stderr.isTTY,
  });

  process.on('uncaughtException', (err) => {
    logEvent('uncaughtException', { error: formatError(err) });
    process.exitCode = 1;
  });

  process.on('unhandledRejection', (reason) => {
    logEvent('unhandledRejection', { reason: formatError(reason) });
    process.exitCode = 1;
  });

  const tapSignal = (signal) => {
    const hadExisting = process.listenerCount(signal) > 0;
    const handler = () => {
      logEvent('signal', { signal });
      process.off(signal, handler);
      if (!hadExisting) {
        try {
          process.kill(process.pid, signal);
        } catch {
          // ignore
        }
      }
    };
    process.on(signal, handler);
  };

  tapSignal('SIGINT');
  tapSignal('SIGTERM');
  tapSignal('SIGHUP');

  process.on('beforeExit', (code) => logEvent('beforeExit', { code }));
  process.on('exit', (code) => logEvent('exit', { code }));

  return { logEvent };
}
