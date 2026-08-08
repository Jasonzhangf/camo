// camo v2 process entry. Module id=shell.bin_entry.
//
// `bin/camo` (top-level) is a thin shell script that runs this file
// with node. argv flows through argv-parser -> registry -> builtins ->
// transport -> result. Errors are surfaced via CamoError -> stderr.
//
// Hard guards:
//   - Single argv entrypoint.
//   - No side effects on import.
//   - All IO dispatches via the builtins + transports stack.
//   - No fake transport fallback.
//   - Auto-discovers or auto-starts daemon as needed.

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dispatch, usage } from '../cli/dispatch.mjs';
import { isCamoError, toWire } from '../../contracts/error_envelope/projector.mjs';
import { loadConfig } from '../config/loader.mjs';
import { findActiveDaemon } from '../config/daemon_finder.mjs';
import { checkCamoufoxHealth, ensureCamoufox } from '../camoufox_health.mjs';

// PKG_ROOT is set by the bin/camo.mjs entry shim via CAMO_PKG_ROOT env var;
// fallback 到本文件位置向上推导（bin_entry -> shell -> v2 -> 仓库根），
// 保证直接 node 启动本文件也能解析资源路径。
const PKG_ROOT = process.env.CAMO_PKG_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DAEMON_SCRIPT = path.join(PKG_ROOT, 'v2', 'shell', 'daemon', 'index.mjs');
const DAEMON_DIR = path.join(os.homedir(), '.camo', 'daemon');

function makeWsTransport(url) {
  return {
    async sendFrame(env) {
      const { WebSocket } = await import('ws');
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          reject(Object.assign(new Error('WS timeout'), { code: 'E_IO_TIMEOUT' }));
        }, 30000);
        ws.on('open', () => { ws.send(JSON.stringify(env)); });
        ws.on('message', (data) => {
          clearTimeout(timeout);
          ws.close();
          try { resolve(JSON.parse(String(data))); }
          catch(e) { reject(e); }
        });
        ws.on('error', (e) => {
          clearTimeout(timeout);
          ws.close();
          reject(Object.assign(new Error('WS error: ' + e.message), { code: 'E_IO_CONNECT' }));
        });
      });
    },
  };
}

const NO_TRANSPORT_CMDS = new Set([
    '--help', '-h', 'help', 'doctor', 'usage', 'describe',
    '--version', 'version', 'daemon', 'stop',
    'list-profiles', 'remove-profile', 'clean', 'init',
    'search',
  ]);
const PROCESS_ONLY_CMDS = new Set(['daemon']);

async function waitForDaemon(profile, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const daemon = findActiveDaemon({ profile, ephemeral: true });
    if (daemon) return daemon;
    await new Promise(r => setTimeout(r, 200));
  }
  throw Object.assign(new Error('Daemon did not start within timeout'), { code: 'E_DAEMON_NOT_FOUND' });
}

async function startDaemon(profile, mode) {
  const args = [];
  if (profile && !profile.startsWith('_ephemeral_')) {
    args.push('--profile', profile);
  } else {
    args.push('--ephemeral');
  }
  if (process.env.CAMO_HEADLESS === '1') args.push('--headless');

  const child = spawn(process.execPath, [DAEMON_SCRIPT, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });

  child.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[camo] daemon exited with code ${code}`);
      if (stderr) console.error(stderr);
    }
  });

  try {
    const daemon = await waitForDaemon(profile);
    return { wsUrl: `ws://localhost:${daemon.wsPort}`, daemon, child };
  } catch (err) {
    if (stderr) console.error(stderr);
    throw err;
  }
}

async function main(argv) {
  const args = argv.slice(2);
  const config = loadConfig({});

  // handle --version specially
  if (args.includes('--version') || args.includes('-v')) {
    const pkgRoot = PKG_ROOT;
    const pkgFile = path.join(pkgRoot, 'package.json');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      process.stdout.write(pkg.version + '\n');
      return 0;
    } catch {
      process.stdout.write('0.0.0\n');
      return 0;
    }
  }

  const hasHelpFlag = args.includes('--help') || args.includes('-h');
  const isBrowserCmd = args.length > 0 && !hasHelpFlag && (
    ['goto', 'click', 'type', 'scroll', 'screenshot', 'get-page-info', 'get-cookies', 
     'set-cookies', 'evaluate', 'find-elements', 'wait', 'hover', 'select', 'upload',
     'fetch-page', 'snapshot', 'scroll-and-collect', 'get-readable', 'get-text',
     'new-tab', 'close-tab', 'list-tabs', 'set-viewport', 'set-user-agent', 'start'].includes(args[0])
  );
  
  if (isBrowserCmd) {
    const health = await checkCamoufoxHealth();
    if (!health.ok) {
      if (health.error?.includes('not found')) {
        console.error('Camoufox not found, downloading...');
        await ensureCamoufox();
      } else {
        process.stderr.write('Camoufox error: ' + (health.error || 'unknown') + '\n');
        return 2;
      }
    }
  }

  const needsTransport = !hasHelpFlag
    && args.length > 0
    && !NO_TRANSPORT_CMDS.has(args[0])
    && !PROCESS_ONLY_CMDS.has(args[0]);
  
  const processOnly = PROCESS_ONLY_CMDS.has(args[0]);
  if (!needsTransport || processOnly) {
    try {
      const out = await dispatch(args, { transport: null, config, processOnly });
      if (out.kind === 'help') {
        process.stdout.write((out.usage || usage()) + '\n');
        return 0;
      }
      if (out.kind === 'doctor') {
        process.stdout.write(JSON.stringify(out.report, null, 2) + '\n');
        return 0;
      }
      if (out.kind === 'usage') {
        process.stdout.write((out.usage || usage()) + '\n');
        return 2;
      }
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return 0;
    } catch (cause) {
      if (isCamoError(cause)) {
        const wire = toWire(cause);
        process.stderr.write('camo: [' + wire.code + '] ' + wire.message + '\n');
        if (wire.details) process.stderr.write('  details: ' + JSON.stringify(wire.details) + '\n');
        return 2;
      }
      process.stderr.write('camo: internal error: ' + (cause && cause.message || String(cause)) + '\n');
      return 3;
    }
  }

  let profile = config.profile;
  let isEphemeral = true;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      profile = args[i + 1];
      isEphemeral = false;
    }
    if (args[i] === '--ephemeral') {
      isEphemeral = true;
      profile = `_ephemeral_${process.pid}_${Date.now()}`;
    }
  }
  if (isEphemeral && !profile && args[0] !== 'start') profile = `_ephemeral_${process.pid}_${Date.now()}`;
  // For `start` without --profile, default to the 'default' profile so
  // the single-command boot flow lands on a real persistent profile.
  if (args[0] === 'start' && !profile) { profile = 'default'; isEphemeral = false; }

  let transport;
  let daemonChild = null;
  
  const existing = findActiveDaemon({ profile, ephemeral: isEphemeral });
  if (existing) {
    transport = makeWsTransport(`ws://localhost:${existing.wsPort}`);
  } else if (process.env.CAMO_AUTOSTART === '1' || args[0] === 'start') {
    const daemon = await startDaemon(profile, isEphemeral ? 'ephemeral' : 'persistent');
    transport = makeWsTransport(daemon.wsUrl);
  } else {
    process.stderr.write(`camo: no active daemon for profile "${profile}". Run 'camo daemon start --profile ${profile}' first, or set CAMO_AUTOSTART=1.\n`);
    return 2;
  }

  try {
    const out = await dispatch(args, { transport, config });
    if (out.kind === 'result') {
      process.stdout.write(JSON.stringify(out.result, null, 2) + '\n');
      return 0;
    }
    if (out.kind === 'usage') {
      process.stdout.write((out.usage || usage()) + '\n');
      return 2;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  } catch (cause) {
    if (isCamoError(cause)) {
      const wire = toWire(cause);
      process.stderr.write('camo: [' + wire.code + '] ' + wire.message + '\n');
      if (wire.details) process.stderr.write('  details: ' + JSON.stringify(wire.details) + '\n');
      return 2;
    }
    process.stderr.write('camo: internal error: ' + (cause && cause.message || String(cause)) + '\n');
    return 3;
  } finally {
    if (isEphemeral && daemonChild) {
      setTimeout(() => {
        try { daemonChild.kill('SIGTERM'); }
        catch (cause) {
          process.stderr.write(`camo: failed to terminate daemon ${daemonChild.pid}: ${cause?.message || cause}\n`);
        }
      }, 500);
    }
  }
}

const exitCode = await main(process.argv).catch((e) => {
  process.stderr.write('camo: fatal: ' + (e && e.message || String(e)) + '\n');
  process.exit(3);
});
process.exit(exitCode);
