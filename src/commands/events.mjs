import { createProgressWsServer } from '../events/ws-server.mjs';
import { getProgressEventsFile, readRecentProgressEvents, safeAppendProgressEvent } from '../events/progress-log.mjs';
import { ensureProgressEventDaemon } from '../events/daemon.mjs';

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function buildQuery(args) {
  const profileId = readFlagValue(args, ['--profile', '-p']);
  const runId = readFlagValue(args, ['--run-id']);
  const mode = readFlagValue(args, ['--mode']);
  const events = readFlagValue(args, ['--events']);
  const replay = Math.max(0, Number(readFlagValue(args, ['--replay']) ?? 50) || 50);
  const qs = new URLSearchParams();
  if (profileId) qs.set('profileId', profileId);
  if (runId) qs.set('runId', runId);
  if (mode) qs.set('mode', mode);
  if (events) qs.set('events', events);
  qs.set('replay', String(replay));
  return qs;
}

async function handleEventsServe(args) {
  const host = readFlagValue(args, ['--host']) || '127.0.0.1';
  const port = Math.max(1, Number(readFlagValue(args, ['--port']) || 7788) || 7788);
  const pollMs = Math.max(80, Number(readFlagValue(args, ['--poll-ms']) || 220) || 220);
  const fromStart = hasFlag(args, '--from-start');

  const server = createProgressWsServer({ host, port, pollMs, fromStart });
  const info = await server.start();
  console.log(JSON.stringify({
    ok: true,
    command: 'events.serve',
    ...info,
    message: 'Progress WS server started. Press Ctrl+C to stop.',
  }, null, 2));

  const stop = async (reason = 'signal_interrupt') => {
    await server.stop();
    console.log(JSON.stringify({ ok: true, event: 'events.serve.stop', reason }));
    process.exit(0);
  };
  process.once('SIGINT', () => {
    stop('SIGINT');
  });
  process.once('SIGTERM', () => {
    stop('SIGTERM');
  });

  await new Promise(() => {});
}

async function handleEventsTail(args) {
  const host = readFlagValue(args, ['--host']) || '127.0.0.1';
  const port = Math.max(1, Number(readFlagValue(args, ['--port']) || 7788) || 7788);
  await ensureProgressEventDaemon({ host, port });
  const qs = buildQuery(args);
  const wsUrl = `ws://${host}:${port}/events?${qs.toString()}`;
  if (typeof WebSocket !== 'function') {
    throw new Error('Global WebSocket is unavailable in this Node runtime');
  }

  const socket = new WebSocket(wsUrl);
  socket.addEventListener('open', () => {
    console.log(JSON.stringify({ ok: true, command: 'events.tail', wsUrl }));
  });
  socket.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : String(event.data);
    console.log(text);
  });
  socket.addEventListener('close', () => {
    process.exit(0);
  });
  socket.addEventListener('error', (err) => {
    console.error(JSON.stringify({ ok: false, command: 'events.tail', wsUrl, error: err?.message || String(err) }));
    process.exit(1);
  });
  process.once('SIGINT', () => {
    socket.close();
  });

  await new Promise(() => {});
}

function handleEventsRecent(args) {
  const limit = Math.max(1, Number(readFlagValue(args, ['--limit', '-n']) || 50) || 50);
  const rows = readRecentProgressEvents(limit);
  console.log(JSON.stringify({
    ok: true,
    command: 'events.recent',
    file: getProgressEventsFile(),
    count: rows.length,
    events: rows,
  }, null, 2));
}

function handleEventsEmit(args) {
  const eventName = readFlagValue(args, ['--event']) || 'manual.emit';
  const mode = readFlagValue(args, ['--mode']) || 'normal';
  const profileId = readFlagValue(args, ['--profile', '-p']) || null;
  const runId = readFlagValue(args, ['--run-id']) || null;
  const payloadRaw = readFlagValue(args, ['--payload']) || '{}';
  let payload = null;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    payload = { raw: payloadRaw };
  }
  const appended = safeAppendProgressEvent({
    source: 'events.emit',
    mode,
    profileId,
    runId,
    event: eventName,
    payload,
  });
  console.log(JSON.stringify({ ok: Boolean(appended), command: 'events.emit', event: appended }, null, 2));
}

export async function handleEventsCommand(args) {
  const sub = args[1];
  switch (sub) {
    case 'serve':
      return handleEventsServe(args);
    case 'tail':
      return handleEventsTail(args);
    case 'recent':
      return handleEventsRecent(args);
    case 'emit':
      return handleEventsEmit(args);
    default:
      console.log(`Usage: camo events <serve|tail|recent|emit> [options]

Commands:
  serve [--host 127.0.0.1] [--port 7788] [--poll-ms 220] [--from-start]
  tail [--host 127.0.0.1] [--port 7788] [--profile <id>] [--run-id <id>] [--mode <normal|autoscript>] [--events e1,e2] [--replay 50]
  recent [--limit 50]
  emit --event <name> [--mode <normal|autoscript>] [--profile <id>] [--run-id <id>] [--payload '{"k":"v"}']
`);
  }
}
