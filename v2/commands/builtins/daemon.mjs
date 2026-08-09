// camo v2 builtin: `camo daemon start|stop|status`
//
// Process-level daemon control. Starts a detached daemon child process
// (camo v2 daemon entry script). The daemon process claims and writes the one
// canonical shared registration. Other commands select profiles through it.
//
// Hard guards:
//   - daemon start is the ONLY way to bring up the browser runtime from CLI
//   - No retry; no fallback. Caller may retry with explicit backoff.
//   - daemon stop is idempotent: missing daemon exits 0 with reason.

import { spawn } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { findActiveDaemon, listRegistrations } from '../../services/daemon_registration/registry.mjs';

export const cmd = 'daemon';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DAEMON_SCRIPT = path.join(__dirname, '..', '..', 'shell', 'daemon', 'index.mjs');

function safeProfile(profileId) {
  const id = String(profileId || 'default').trim();
  if (!id) throw new CamoError({ code: 'E_INPUT_MISSING_FIELD', details: { field: 'profileId' } });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'profileId', value: id } });
  return id;
}

async function waitForDaemonRegistration(profile, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const reg = findActiveDaemon();
    if (reg) return reg;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Object.assign(
    new Error('Daemon did not register within timeout'),
    { code: 'E_DAEMON_START_FAILED', details: { profile, timeoutMs } }
  );
}

export async function run(_transport, parsed = {}, _ctx = {}) {
  const sub = String(parsed.positional?.[0] || 'status').trim();
  const profile = safeProfile(parsed.profile || process.env.CAMO_PROFILE || 'default');

  switch (sub) {
    case 'start': {
      const existing = findActiveDaemon();
      if (existing) {
        return { cmd: 'daemon.start', profile, status: 'already_running', pid: existing.pid, wsPort: existing.wsPort };
      }
      const args = ['--profile', profile];
      if (parsed.named?.ephemeral === true) args.push('--ephemeral');
      const child = spawn(process.execPath, [DAEMON_SCRIPT, ...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        env: { ...process.env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
      });
      // Detach the child so it survives after this process exits
      child.unref();
      const stderrBuf = [];
      child.stderr.on('data', (c) => stderrBuf.push(String(c)));
      child.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          process.stderr.write(`[camo] daemon (pid=${child.pid}) exited ${code}\n${stderrBuf.join('')}\n`);
        }
      });
      let reg;
      try {
        reg = await waitForDaemonRegistration(profile);
      } catch (cause) {
        process.stderr.write(`camo: daemon did not start: ${cause.message}\n${stderrBuf.join('')}\n`);
        try { child.kill('SIGTERM'); } catch {}
        throw new CamoError({
          code: 'E_DAEMON_START_FAILED',
          details: { profile, reason: cause?.message || String(cause), stderr: stderrBuf.join('').slice(-2000) },
          cause,
        });
      }
      if (reg.pid !== child.pid) {
        return { cmd: 'daemon.start', profile, status: 'already_running', pid: reg.pid, wsPort: reg.wsPort, httpPort: reg.httpPort, daemonId: reg.daemonId };
      }
      return { cmd: 'daemon.start', profile, status: 'started', pid: reg.pid, wsPort: reg.wsPort, httpPort: reg.httpPort, daemonId: reg.daemonId };
    }

    case 'stop': {
      const reg = findActiveDaemon();
      if (!reg) {
        return { cmd: 'daemon.stop', profile, status: 'not_running' };
      }
      try {
        process.kill(reg.pid, 'SIGTERM');
      } catch (cause) {
        if (cause.code === 'ESRCH') {
          return { cmd: 'daemon.stop', profile, status: 'already_dead', pid: reg.pid };
        }
        throw new CamoError({
          code: 'E_DAEMON_STOP_FAILED',
          details: { profile, pid: reg.pid, reason: cause?.message || String(cause) },
          cause,
        });
      }
      const start = Date.now();
      while (Date.now() - start < 5000) {
        try { process.kill(reg.pid, 0); }
        catch {
          if (listRegistrations({ includeStale: true }).length === 0) {
            return { cmd: 'daemon.stop', profile, status: 'stopped', pid: reg.pid };
          }
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      throw new CamoError({
        code: 'E_DAEMON_STOP_FAILED',
        details: { profile, pid: reg.pid, reason: 'pid still alive after SIGTERM + 5s' },
      });
    }

    case 'status': {
      const reg = findActiveDaemon();
      if (!reg) return { cmd: 'daemon.status', profile, status: 'not_running' };
      return { cmd: 'daemon.status', profile, status: 'running', pid: reg.pid, wsPort: reg.wsPort, httpPort: reg.httpPort, startedAt: reg.startedAt, mode: reg.mode };
    }

    default:
      throw new CamoError({
        code: 'E_INPUT_OUT_OF_RANGE',
        details: { field: 'subcommand', value: sub, allowed: ['start', 'stop', 'status'] },
      });
  }
}
