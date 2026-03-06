import { resolveWsUrl, ensureWsClient } from '../utils/ws-client.mjs';

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function isJsonLine(line) {
  const trimmed = String(line || '').trim();
  return trimmed.startsWith('{') && trimmed.endsWith('}');
}

function nextRequestId() {
  return `attach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeCommand(lineObj, sessionId) {
  if (lineObj && typeof lineObj === 'object') {
    if (lineObj.type) {
      return {
        request_id: lineObj.request_id || nextRequestId(),
        session_id: lineObj.session_id || sessionId,
        ...lineObj,
      };
    }
    if (lineObj.command_type || lineObj.commandType) {
      return {
        type: 'command',
        request_id: lineObj.request_id || nextRequestId(),
        session_id: lineObj.session_id || sessionId,
        data: {
          command_type: lineObj.command_type || lineObj.commandType,
          action: lineObj.action,
          parameters: lineObj.parameters || lineObj.args || {},
        },
      };
    }
    if (lineObj.action) {
      return {
        type: 'command',
        request_id: lineObj.request_id || nextRequestId(),
        session_id: lineObj.session_id || sessionId,
        data: {
          command_type: 'dev_command',
          action: lineObj.action,
          parameters: lineObj.args || lineObj.parameters || {},
        },
      };
    }
  }
  return null;
}

export async function handleAttachCommand(args) {
  const target = args[1];
  if (!target) {
    throw new Error('Usage: camo attach <profileId|sessionId> [--format json|jsonl]');
  }

  const sessionId = target;
  const format = readFlagValue(args, ['--format']) || 'jsonl';
  const wsUrl = resolveWsUrl();
  const socket = await ensureWsClient(wsUrl);

  const send = (msg) => socket.send(JSON.stringify(msg));
  const output = (obj) => {
    if (format === 'json') {
      process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
    } else {
      process.stdout.write(JSON.stringify(obj) + '\n');
    }
  };

  send({
    type: 'subscribe',
    request_id: nextRequestId(),
    session_id: sessionId,
    data: { topics: ['browser.runtime.event'] },
  });

  output({ ok: true, attached: sessionId, wsUrl, format });

  let closing = false;

  socket.addEventListener('message', (event) => {
    const text = typeof event.data === 'string' ? event.data : String(event.data);
    output({ type: 'ws', data: text });
  });

  socket.addEventListener('close', () => {
    if (!closing) output({ ok: false, event: 'ws_closed' });
    process.exit(0);
  });

  socket.addEventListener('error', (err) => {
    output({ ok: false, event: 'ws_error', error: err?.message || String(err) });
    process.exit(1);
  });

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      if (!isJsonLine(line)) {
        output({ ok: false, error: 'Invalid JSON line', line });
        continue;
      }
      try {
        const payload = JSON.parse(line);
        const msg = normalizeCommand(payload, sessionId);
        if (!msg) {
          output({ ok: false, error: 'Invalid command payload', payload });
          continue;
        }
        send(msg);
        output({ ok: true, sent: msg.request_id });
      } catch (err) {
        output({ ok: false, error: err?.message || String(err) });
      }
    }
  });

  process.stdin.on('end', () => {
    closing = true;
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      process.exit(0);
    }, 1500);
    timer.unref();
  });
}
