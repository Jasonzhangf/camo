export function resolveWsUrl() {
  const explicit = String(process.env.CAMO_WS_URL || '').trim();
  if (explicit) return explicit;
  const host = String(process.env.CAMO_WS_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const port = Number(process.env.CAMO_WS_PORT || 8765) || 8765;
  return `ws://${host}:${port}`;
}

export async function ensureWsClient(wsUrl = resolveWsUrl()) {
  if (typeof WebSocket !== 'function') {
    throw new Error('Global WebSocket is unavailable in this Node runtime');
  }
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { socket.close(); } catch {}
      reject(new Error(`WebSocket connect timeout: ${wsUrl}`));
    }, 8000);

    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(socket);
    });

    socket.addEventListener('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket connect failed: ${err?.message || String(err)}`));
    });
  });
}
