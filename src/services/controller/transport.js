import WebSocket from 'ws';

export function createTransport({ env = process.env, defaults = {}, debugLog = null } = {}) {
  const getBrowserWsUrl = () => {
    if (env.CAMO_WS_URL) return env.CAMO_WS_URL;
    const host = env.CAMO_WS_HOST || defaults.wsHost || '127.0.0.1';
    const port = Number(env.CAMO_WS_PORT || defaults.wsPort || 8765);
    return `ws://${host}:${port}`;
  };

  const getBrowserHttpBase = () => {
    if (env.CAMO_BROWSER_HTTP_BASE) return env.CAMO_BROWSER_HTTP_BASE.replace(/\/$/, '');
    const host = env.CAMO_BROWSER_HTTP_HOST || defaults.httpHost || '127.0.0.1';
    const port = Number(env.CAMO_BROWSER_HTTP_PORT || defaults.httpPort || 7704);
    const protocol = env.CAMO_BROWSER_HTTP_PROTO || defaults.httpProtocol || 'http';
    return `${protocol}://${host}:${port}`;
  };

  const browserServiceCommand = async (action, args, options = {}) => {
    const timeoutMs = typeof options.timeoutMs === 'number' && options.timeoutMs > 0
      ? options.timeoutMs
      : 20000;
    const profileId = (args?.profileId || args?.profile || args?.sessionId || '').toString();
    debugLog?.('browserServiceCommand:start', { action, profileId, timeoutMs });
    const res = await fetch(`${getBrowserHttpBase()}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined,
    });

    const raw = await res.text();
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = { raw };
    }

    if (!res.ok) {
      debugLog?.('browserServiceCommand:http_err', { action, profileId, status: res.status, raw: raw?.slice?.(0, 200) });
      throw new Error(data?.error || data?.body?.error || `browser-service command "${action}" HTTP ${res.status}`);
    }
    if (data && data.ok === false) {
      debugLog?.('browserServiceCommand:ok_false', { action, profileId, error: data.error });
      throw new Error(data.error || `browser-service command "${action}" failed`);
    }
    if (data && data.error) {
      debugLog?.('browserServiceCommand:body_err', { action, profileId, error: data.error });
      throw new Error(data.error);
    }
    debugLog?.('browserServiceCommand:ok', { action, profileId });
    return data.body ?? data;
  };

  const sendWsCommand = (wsUrl, payload, timeoutMs = 15000) => new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.terminate();
      reject(new Error('WebSocket command timeout'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeAllListeners();
    };

    socket.once('open', () => {
      try {
        socket.send(JSON.stringify(payload));
      } catch (err) {
        cleanup();
        if (!settled) {
          settled = true;
          reject(err);
        }
      }
    });

    socket.once('message', (data) => {
      cleanup();
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(data.toString('utf-8')));
      } catch (err) {
        reject(err);
      } finally {
        socket.close();
      }
    });

    socket.once('error', (err) => {
      cleanup();
      if (settled) return;
      settled = true;
      reject(err);
    });

    socket.once('close', () => {
      cleanup();
      if (!settled) {
        settled = true;
        reject(new Error('WebSocket closed before response'));
      }
    });
  });

  return {
    getBrowserWsUrl,
    getBrowserHttpBase,
    browserServiceCommand,
    sendWsCommand,
  };
}
