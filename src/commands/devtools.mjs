import { getDefaultProfile, listProfiles } from '../utils/config.mjs';
import { callAPI } from '../utils/browser-service.mjs';

const DEFAULT_LIMIT = 120;
const MAX_LIMIT = 1000;

function parseNumber(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function collectPositionals(args, startIndex = 2) {
  const values = [];
  for (let i = startIndex; i < args.length; i += 1) {
    const token = args[i];
    if (!token || String(token).startsWith('--')) {
      continue;
    }
    const prev = args[i - 1];
    if (prev && ['--profile', '-p', '--limit', '-n', '--levels', '--since'].includes(prev)) {
      continue;
    }
    values.push(String(token));
  }
  return values;
}

function pickProfileAndExpression(args, subcommand) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  const profileSet = new Set(listProfiles());
  const positionals = collectPositionals(args, 2);

  let profileId = explicitProfile || null;
  let expression = null;

  if (subcommand === 'eval') {
    if (positionals.length === 0) {
      return { profileId: profileId || getDefaultProfile(), expression: null };
    }
    if (!profileId && positionals.length >= 2) {
      profileId = positionals[0];
      expression = positionals.slice(1).join(' ').trim();
    } else if (!profileId && profileSet.has(positionals[0])) {
      profileId = positionals[0];
      expression = positionals.slice(1).join(' ').trim();
    } else {
      expression = positionals.join(' ').trim();
    }
    return { profileId: profileId || getDefaultProfile(), expression };
  }

  if (positionals.length > 0) {
    if (!profileId && (profileSet.has(positionals[0]) || subcommand === 'logs' || subcommand === 'clear')) {
      profileId = positionals[0];
    }
  }
  return { profileId: profileId || getDefaultProfile(), expression: null };
}

function buildConsoleInstallScript(maxEntries) {
  return `(function installCamoDevtoolsConsoleCollector() {
    const KEY = '__camo_console_collector_v1__';
    const BUFFER_KEY = '__camo_console_buffer_v1__';
    const MAX = ${Math.max(100, Math.floor(maxEntries || MAX_LIMIT))};
    const now = () => Date.now();

    const stringify = (value) => {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
      if (value === null) return 'null';
      if (typeof value === 'undefined') return 'undefined';
      if (typeof value === 'function') return '[function]';
      if (typeof value === 'symbol') return String(value);
      if (value instanceof Error) return value.stack || value.message || String(value);
      try {
        return JSON.stringify(value);
      } catch {
        return Object.prototype.toString.call(value);
      }
    };

    const pushEntry = (level, args) => {
      const target = window[BUFFER_KEY];
      if (!Array.isArray(target)) return;
      const text = Array.from(args || []).map(stringify).join(' ');
      target.push({
        ts: now(),
        level,
        text,
        href: String(window.location?.href || ''),
      });
      if (target.length > MAX) {
        target.splice(0, target.length - MAX);
      }
    };

    if (!Array.isArray(window[BUFFER_KEY])) {
      window[BUFFER_KEY] = [];
    }

    if (!window[KEY]) {
      const levels = ['log', 'info', 'warn', 'error', 'debug'];
      const originals = {};
      for (const level of levels) {
        const raw = typeof console[level] === 'function' ? console[level] : console.log;
        originals[level] = raw.bind(console);
        console[level] = (...args) => {
          try {
            pushEntry(level, args);
          } catch {}
          return originals[level](...args);
        };
      }

      window.addEventListener('error', (event) => {
        try {
          const message = event?.message || 'window.error';
          pushEntry('error', [message]);
        } catch {}
      });
      window.addEventListener('unhandledrejection', (event) => {
        try {
          const reason = event?.reason instanceof Error
            ? (event.reason.stack || event.reason.message)
            : stringify(event?.reason);
          pushEntry('error', ['unhandledrejection', reason]);
        } catch {}
      });

      window[KEY] = { installedAt: now(), max: MAX };
    }

    return {
      ok: true,
      installed: true,
      entries: Array.isArray(window[BUFFER_KEY]) ? window[BUFFER_KEY].length : 0,
      max: MAX,
    };
  })();`;
}

function buildConsoleReadScript(options = {}) {
  const limit = clamp(parseNumber(options.limit, DEFAULT_LIMIT), 1, MAX_LIMIT);
  const sinceTs = Math.max(0, parseNumber(options.sinceTs, 0) || 0);
  const clear = options.clear === true;
  const levels = Array.isArray(options.levels)
    ? options.levels.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    : [];
  const levelsLiteral = JSON.stringify(levels);

  return `(function readCamoDevtoolsConsole() {
    const BUFFER_KEY = '__camo_console_buffer_v1__';
    const raw = Array.isArray(window[BUFFER_KEY]) ? window[BUFFER_KEY] : [];
    const levelSet = new Set(${levelsLiteral});
    const list = raw.filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      const ts = Number(entry.ts || 0);
      if (ts < ${sinceTs}) return false;
      if (levelSet.size === 0) return true;
      return levelSet.has(String(entry.level || '').toLowerCase());
    });
    const entries = list.slice(Math.max(0, list.length - ${limit}));
    if (${clear ? 'true' : 'false'}) {
      window[BUFFER_KEY] = [];
    }
    return {
      ok: true,
      total: raw.length,
      returned: entries.length,
      sinceTs: ${sinceTs},
      levels: Array.from(levelSet),
      cleared: ${clear ? 'true' : 'false'},
      entries,
    };
  })();`;
}

function buildEvalScript(expression) {
  return `(async function runCamoDevtoolsEval() {
    const expr = ${JSON.stringify(expression || '')};
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const resultPayload = { ok: true, mode: 'expression', value: null, valueType: null };

    const toSerializable = (value, depth = 0, seen = new WeakSet()) => {
      if (value === null) return null;
      if (typeof value === 'undefined') return '[undefined]';
      if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
      if (typeof value === 'bigint') return value.toString();
      if (typeof value === 'function') return '[function]';
      if (typeof value === 'symbol') return value.toString();
      if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || null };
      if (depth >= 3) return '[max-depth]';
      if (Array.isArray(value)) return value.slice(0, 30).map((item) => toSerializable(item, depth + 1, seen));
      if (typeof value === 'object') {
        if (seen.has(value)) return '[circular]';
        seen.add(value);
        const out = {};
        const keys = Object.keys(value).slice(0, 30);
        for (const key of keys) {
          out[key] = toSerializable(value[key], depth + 1, seen);
        }
        return out;
      }
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return String(value);
      }
    };

    try {
      const fn = new AsyncFunction('return (' + expr + ')');
      const value = await fn();
      resultPayload.value = toSerializable(value);
      resultPayload.valueType = typeof value;
      return resultPayload;
    } catch (exprError) {
      try {
        const fn = new AsyncFunction(expr);
        const value = await fn();
        resultPayload.mode = 'statement';
        resultPayload.value = toSerializable(value);
        resultPayload.valueType = typeof value;
        return resultPayload;
      } catch (statementError) {
        return {
          ok: false,
          mode: 'statement',
          error: {
            message: statementError?.message || String(statementError),
            stack: statementError?.stack || null,
            expressionError: exprError?.message || String(exprError),
          },
        };
      }
    }
  })();`;
}

async function ensureConsoleCollector(profileId, maxEntries = MAX_LIMIT) {
  return callAPI('evaluate', {
    profileId,
    script: buildConsoleInstallScript(maxEntries),
  });
}

async function handleLogs(args) {
  const { profileId } = pickProfileAndExpression(args, 'logs');
  if (!profileId) {
    throw new Error('No default profile set. Run: camo profile default <profileId>');
  }
  const limit = clamp(parseNumber(readFlagValue(args, ['--limit', '-n']), DEFAULT_LIMIT), 1, MAX_LIMIT);
  const sinceTs = Math.max(0, parseNumber(readFlagValue(args, ['--since']), 0) || 0);
  const levelsRaw = readFlagValue(args, ['--levels', '--level']) || '';
  const levels = levelsRaw
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  const clear = args.includes('--clear');

  const install = await ensureConsoleCollector(profileId, MAX_LIMIT);
  const result = await callAPI('evaluate', {
    profileId,
    script: buildConsoleReadScript({ limit, sinceTs, levels, clear }),
  });

  console.log(JSON.stringify({
    ok: true,
    command: 'devtools.logs',
    profileId,
    collector: install?.result || install?.data || install || null,
    result: result?.result || result?.data || result || null,
  }, null, 2));
}

async function handleClear(args) {
  const { profileId } = pickProfileAndExpression(args, 'clear');
  if (!profileId) {
    throw new Error('No default profile set. Run: camo profile default <profileId>');
  }
  await ensureConsoleCollector(profileId, MAX_LIMIT);
  const result = await callAPI('evaluate', {
    profileId,
    script: buildConsoleReadScript({ limit: MAX_LIMIT, sinceTs: 0, clear: true }),
  });
  console.log(JSON.stringify({
    ok: true,
    command: 'devtools.clear',
    profileId,
    result: result?.result || result?.data || result || null,
  }, null, 2));
}

async function handleEval(args) {
  const { profileId, expression } = pickProfileAndExpression(args, 'eval');
  if (!profileId) {
    throw new Error('No default profile set. Run: camo profile default <profileId>');
  }
  if (!expression) {
    throw new Error('Usage: camo devtools eval [profileId] <expression> [--profile <id>]');
  }

  await ensureConsoleCollector(profileId, MAX_LIMIT);
  const result = await callAPI('evaluate', {
    profileId,
    script: buildEvalScript(expression),
  });
  console.log(JSON.stringify({
    ok: true,
    command: 'devtools.eval',
    profileId,
    expression,
    result: result?.result || result?.data || result || null,
  }, null, 2));
}

export async function handleDevtoolsCommand(args) {
  const sub = String(args[1] || '').trim().toLowerCase();
  switch (sub) {
    case 'logs':
      return handleLogs(args);
    case 'clear':
      return handleClear(args);
    case 'eval':
      return handleEval(args);
    default:
      console.log(`Usage: camo devtools <logs|eval|clear> [options]

Commands:
  logs [profileId] [--limit 120] [--since <unix_ms>] [--levels error,warn] [--clear]
  eval [profileId] <expression> [--profile <id>]
  clear [profileId]
`);
  }
}
