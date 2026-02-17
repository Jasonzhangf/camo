import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { ensureProgressEventStore, getProgressEventsFile, readRecentProgressEvents } from './progress-log.mjs';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_POLL_MS = 220;
const DEFAULT_REPLAY_LIMIT = 50;

function parseList(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFilter(reqUrl = '/') {
  const url = new URL(reqUrl, 'http://127.0.0.1');
  const events = new Set(parseList(url.searchParams.get('events')));
  return {
    profileId: url.searchParams.get('profileId') || null,
    runId: url.searchParams.get('runId') || null,
    mode: url.searchParams.get('mode') || null,
    events,
    replay: Math.max(0, Number(url.searchParams.get('replay') ?? DEFAULT_REPLAY_LIMIT) || DEFAULT_REPLAY_LIMIT),
  };
}

function matchesFilter(filter, event) {
  if (!event || typeof event !== 'object') return false;
  if (filter.profileId && String(event.profileId || '') !== filter.profileId) return false;
  if (filter.runId && String(event.runId || '') !== filter.runId) return false;
  if (filter.mode && String(event.mode || '') !== filter.mode) return false;
  if (filter.events.size > 0 && !filter.events.has(String(event.event || ''))) return false;
  return true;
}

function frameText(text) {
  const payload = Buffer.from(String(text), 'utf8');
  const length = payload.length;
  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }
  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function framePong() {
  return Buffer.from([0x8A, 0x00]);
}

function frameClose() {
  return Buffer.from([0x88, 0x00]);
}

function parseOpcode(chunk) {
  if (!Buffer.isBuffer(chunk) || chunk.length === 0) return null;
  return chunk[0] & 0x0f;
}

function acceptWebSocketKey(key) {
  return crypto.createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
}

export function createProgressWsServer({
  host = '127.0.0.1',
  port = 7788,
  pollMs = DEFAULT_POLL_MS,
  fromStart = false,
} = {}) {
  ensureProgressEventStore();
  const eventsFile = getProgressEventsFile();
  const clients = new Set();
  let carry = '';
  let cursor = fromStart ? 0 : fs.statSync(eventsFile).size;
  let pollTimer = null;

  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        wsPath: '/events',
        clients: clients.size,
        file: eventsFile,
      }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: 'Use WebSocket upgrade on /events',
      ws: `ws://${host}:${port}/events`,
      file: eventsFile,
    }));
  });

  const sendEvent = (client, event) => {
    if (!client.socket.writable) return;
    if (!matchesFilter(client.filter, event)) return;
    client.socket.write(frameText(JSON.stringify(event)));
  };

  const broadcast = (event) => {
    for (const client of clients) {
      sendEvent(client, event);
    }
  };

  const pollEvents = () => {
    let stat = null;
    try {
      stat = fs.statSync(eventsFile);
    } catch {
      return;
    }
    if (stat.size < cursor) {
      cursor = 0;
      carry = '';
    }
    if (stat.size === cursor) return;

    const fd = fs.openSync(eventsFile, 'r');
    try {
      const length = stat.size - cursor;
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, cursor);
      cursor = stat.size;
      carry += buffer.toString('utf8');
      const lines = carry.split('\n');
      carry = lines.pop() || '';
      for (const line of lines) {
        const raw = line.trim();
        if (!raw) continue;
        try {
          const event = JSON.parse(raw);
          broadcast(event);
        } catch {
          // ignore malformed lines
        }
      }
    } finally {
      fs.closeSync(fd);
    }
  };

  server.on('upgrade', (req, socket) => {
    try {
      const reqUrl = req.url || '/';
      const parsed = new URL(reqUrl, 'http://127.0.0.1');
      if (parsed.pathname !== '/events') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      const key = req.headers['sec-websocket-key'];
      if (!key || Array.isArray(key)) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
        socket.destroy();
        return;
      }

      const accept = acceptWebSocketKey(key);
      socket.write([
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'));

      const filter = buildFilter(reqUrl);
      const client = { socket, filter };
      clients.add(client);

      if (filter.replay > 0) {
        const replay = readRecentProgressEvents(filter.replay);
        for (const event of replay) {
          sendEvent(client, event);
        }
      }

      socket.on('data', (chunk) => {
        const opcode = parseOpcode(chunk);
        if (opcode === 0x8) {
          socket.end(frameClose());
        } else if (opcode === 0x9) {
          socket.write(framePong());
        }
      });
      socket.on('error', () => {
        clients.delete(client);
      });
      socket.on('close', () => {
        clients.delete(client);
      });
      socket.on('end', () => {
        clients.delete(client);
      });
    } catch {
      socket.destroy();
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(port), host, resolve);
      });
      pollTimer = setInterval(pollEvents, Math.max(80, Number(pollMs) || DEFAULT_POLL_MS));
      return {
        host,
        port: Number(port),
        wsUrl: `ws://${host}:${port}/events`,
        file: eventsFile,
      };
    },
    async stop() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

