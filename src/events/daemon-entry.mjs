import { createProgressWsServer } from './ws-server.mjs';

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

async function main() {
  const args = process.argv.slice(2);
  const host = readFlagValue(args, ['--host']) || process.env.CAMO_PROGRESS_WS_HOST || '127.0.0.1';
  const port = Math.max(1, Number(readFlagValue(args, ['--port']) || process.env.CAMO_PROGRESS_WS_PORT || 7788) || 7788);
  const server = createProgressWsServer({ host, port });
  await server.start();

  const stop = async () => {
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
}

main().catch(() => {
  process.exit(1);
});

