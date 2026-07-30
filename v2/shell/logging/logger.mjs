// camo v2 logger. Module id=shell.logging.
//
// Structured logging with level filtering.

const LEVELS = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

const DEFAULT_LEVEL = 'info';

export function createLogger(options = {}) {
  const minLevel = LEVELS[options.level] ?? LEVELS[DEFAULT_LEVEL];
  const output = options.output || console;
  const prefix = options.prefix || '';
  const traceId = options.traceId || null;

  function log(level, message, data = {}) {
    if (LEVELS[level] === undefined || LEVELS[level] < minLevel) {
      return;
    }
    const ts = new Date().toISOString();
    const meta = {
      level,
      ts,
      ...(traceId ? { traceId } : {}),
      ...data,
    };
    const prefixStr = prefix ? `[${prefix}] ` : '';
    const msg = `${ts} ${level.toUpperCase().padEnd(5)} ${prefixStr}${message}`;
    
    if (level === 'error' || level === 'fatal') {
      output.error(msg, meta);
    } else if (level === 'warn') {
      output.warn(msg, meta);
    } else {
      output.log(msg, meta);
    }
  }

  return {
    trace: (msg, data) => log('trace', msg, data),
    debug: (msg, data) => log('debug', msg, data),
    info: (msg, data) => log('info', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    error: (msg, data) => log('error', msg, data),
    fatal: (msg, data) => log('fatal', msg, data),
    setLevel: (level) => {
      if (LEVELS[level] !== undefined) {
        minLevel = LEVELS[level];
      }
    },
    setTraceId: (id) => {
      traceId = id;
    },
  };
}

export const LOG_LEVELS = Object.keys(LEVELS);
