import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

function daemonDir() {
  return path.join(os.homedir(), '.camo', 'daemon');
}

function claimPath() {
  return path.join(daemonDir(), '.shared-daemon.claim');
}

function processIoError(op, pid, cause) {
  return new CamoError({
    code: 'E_IO_PROCESS',
    details: { op, pid, reason: cause?.message || String(cause) },
    cause,
  });
}

export function isProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch (cause) {
    if (cause?.code === 'ESRCH') return false;
    if (cause?.code === 'EPERM') return true;
    throw processIoError('daemon_registration.probe', value, cause);
  }
}

export function getProcessIdentity(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return null;
  if (!isProcessAlive(value)) return null;

  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${value}/stat`, 'utf8');
      const close = stat.lastIndexOf(')');
      const fields = stat.slice(close + 2).split(/\s+/);
      const startTicks = fields[19];
      if (!startTicks) throw new Error('missing /proc start time');
      return `linux:${startTicks}`;
    } catch (cause) {
      throw processIoError('daemon_registration.identity', value, cause);
    }
  }

  if (process.platform === 'darwin') {
    const result = spawnSync('/bin/ps', ['-p', String(value), '-o', 'lstart='], {
      encoding: 'utf8',
    });
    const started = result.stdout?.trim();
    if (result.status !== 0 || !started) {
      throw processIoError(
        'daemon_registration.identity',
        value,
        new Error(result.stderr?.trim() || 'ps returned no process start identity'),
      );
    }
    return `darwin:${started}`;
  }

  if (process.platform === 'win32') {
    const command = `(Get-Process -Id ${value} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`;
    const result = spawnSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      command,
    ], { encoding: 'utf8' });
    const started = result.stdout?.trim();
    if (result.status !== 0 || !started) {
      throw processIoError(
        'daemon_registration.identity',
        value,
        new Error(result.stderr?.trim() || 'PowerShell returned no process start identity'),
      );
    }
    return `win32:${started}`;
  }

  throw new CamoError({
    code: 'E_IO_PROCESS',
    details: {
      op: 'daemon_registration.identity',
      pid: value,
      reason: `process identity is unsupported on platform ${process.platform}`,
    },
  });
}

function validateClaim(raw, file) {
  const valid = raw
    && ['claimed', 'active'].includes(raw.state)
    && Number.isInteger(raw.pid) && raw.pid > 0
    && typeof raw.processIdentity === 'string' && raw.processIdentity.length > 0
    && typeof raw.token === 'string' && raw.token.length > 0
    && typeof raw.claimedAt === 'string' && raw.claimedAt.length > 0;
  if (!valid) {
    throw new CamoError({
      code: 'E_CONFIG_INVALID',
      details: {
        resource: 'daemon_registration_claim',
        path: file,
        reason: 'claim schema is invalid',
      },
    });
  }
  return raw;
}

function readClaim(file = claimPath()) {
  try {
    return validateClaim(JSON.parse(fs.readFileSync(file, 'utf8')), file);
  } catch (cause) {
    if (cause instanceof CamoError) throw cause;
    throw new CamoError({
      code: 'E_CONFIG_INVALID',
      details: {
        resource: 'daemon_registration_claim',
        path: file,
        reason: cause?.message || String(cause),
      },
      cause,
    });
  }
}

function claimOwnerIsCurrent(claim) {
  if (!isProcessAlive(claim.pid)) return false;
  return getProcessIdentity(claim.pid) === claim.processIdentity;
}

function writeExclusiveJson(file, payload) {
  const temporary = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${payload.token}.tmp`,
  );
  let handle;
  try {
    handle = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(handle, JSON.stringify(payload, null, 2), 'utf8');
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    fs.linkSync(temporary, file);
  } finally {
    if (handle !== null && handle !== undefined) fs.closeSync(handle);
    try {
      fs.unlinkSync(temporary);
    } catch (cause) {
      if (cause?.code !== 'ENOENT') throw cause;
    }
  }
}

function duplicateError(claim, extra = {}) {
  return new CamoError({
    code: 'E_STATE_DUPLICATE',
    details: {
      resource: 'shared_daemon',
      pid: claim.pid,
      claimedAt: claim.claimedAt,
      ...extra,
    },
  });
}

function acquireRecoveryClaim(observed) {
  const file = path.join(daemonDir(), '.shared-daemon.recovery');
  const mutexPath = `${file}.mutex`;
  let releaseMutex;
  try {
    releaseMutex = lockfile.lockSync(mutexPath, {
      realpath: false,
      stale: 2000,
      update: 1000,
    });
  } catch (cause) {
    if (cause?.code === 'ELOCKED') throw duplicateError(observed, { recovery: true });
    throw new CamoError({
      code: 'E_STATE_LOCKED',
      details: { resource: 'shared_daemon_recovery', reason: cause?.message || String(cause) },
      cause,
    });
  }

  const recovery = {
    state: 'claimed',
    pid: process.pid,
    processIdentity: getProcessIdentity(process.pid),
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    claimedAt: new Date().toISOString(),
    observedToken: observed.token,
  };
  try {
    if (fs.existsSync(file)) {
      const owner = readClaim(file);
      if (claimOwnerIsCurrent(owner)) throw duplicateError(owner, { recovery: true });
      fs.unlinkSync(file);
    }
    writeExclusiveJson(file, recovery);
  } catch (cause) {
    releaseMutex();
    throw cause;
  }
  return { file, recovery, releaseMutex };
}

function releaseRecoveryClaim({ file, recovery, releaseMutex }) {
  try {
    const active = readClaim(file);
    if (active.token !== recovery.token || active.pid !== process.pid) {
      throw new CamoError({
        code: 'E_STATE_LOCKED',
        details: { resource: 'shared_daemon_recovery', ownerPid: active.pid, callerPid: process.pid },
      });
    }
    fs.unlinkSync(file);
  } finally {
    releaseMutex();
  }
}

export function claimDaemonSlot() {
  const dir = daemonDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = claimPath();
  const claim = {
    state: 'claimed',
    pid: process.pid,
    processIdentity: getProcessIdentity(process.pid),
    token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    claimedAt: new Date().toISOString(),
    hostname: os.hostname(),
  };

  try {
    writeExclusiveJson(file, claim);
    return claim;
  } catch (cause) {
    if (cause?.code !== 'EEXIST') throw cause;
  }

  const observed = readClaim(file);
  if (claimOwnerIsCurrent(observed)) throw duplicateError(observed);

  const recovery = acquireRecoveryClaim(observed);
  try {
    const current = readClaim(file);
    if (current.token !== observed.token || claimOwnerIsCurrent(current)) {
      throw duplicateError(current);
    }
    fs.unlinkSync(file);
    try {
      writeExclusiveJson(file, claim);
    } catch (cause) {
      if (cause?.code !== 'EEXIST') throw cause;
      throw duplicateError(readClaim(file));
    }
    return claim;
  } finally {
    releaseRecoveryClaim(recovery);
  }
}

function assertClaimOwner(claim) {
  const active = readClaim();
  if (
    !claim
    || active.pid !== process.pid
    || claim.pid !== process.pid
    || active.token !== claim.token
    || active.processIdentity !== getProcessIdentity(process.pid)
  ) {
    throw new CamoError({
      code: 'E_STATE_LOCKED',
      details: { resource: 'shared_daemon', ownerPid: active.pid, callerPid: process.pid },
    });
  }
  return active;
}

function activeRegistration(raw, file) {
  const valid = raw.state === 'active'
    && typeof raw.daemonId === 'string' && raw.daemonId.length > 0
    && Number.isInteger(raw.wsPort) && raw.wsPort > 0
    && Number.isInteger(raw.httpPort) && raw.httpPort > 0
    && raw.scope === 'shared'
    && typeof raw.headless === 'boolean'
    && typeof raw.startedAt === 'string' && raw.startedAt.length > 0;
  if (!valid) {
    throw new CamoError({
      code: 'E_CONFIG_INVALID',
      details: {
        resource: 'daemon_registration',
        path: file,
        reason: 'registration does not match the shared-daemon schema',
      },
    });
  }
  return raw;
}

export function parseRegistration(file = claimPath()) {
  return activeRegistration(readClaim(file), file);
}

export function listRegistrations({ includeStale = false } = {}) {
  const file = claimPath();
  if (!fs.existsSync(file)) return [];
  const claim = readClaim(file);
  if (claim.state !== 'active') return [];
  const registration = activeRegistration(claim, file);
  return includeStale || claimOwnerIsCurrent(registration) ? [registration] : [];
}

export function findActiveDaemon({ pid } = {}) {
  return listRegistrations().find((registration) => !pid || registration.pid === pid) || null;
}

export function registerDaemon({ claim, wsPort, httpPort, headless }) {
  const active = assertClaimOwner(claim);
  const payload = {
    ...active,
    state: 'active',
    daemonId: `daemon-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    wsPort,
    httpPort,
    scope: 'shared',
    headless: headless === true,
    startedAt: new Date().toISOString(),
  };
  const file = claimPath();
  const temporary = `${file}.${claim.token}.active`;
  fs.writeFileSync(temporary, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  return payload;
}

export function releaseDaemonSlot(claim) {
  assertClaimOwner(claim);
  fs.unlinkSync(claimPath());
  return true;
}

export function unregisterDaemon(daemonId, claim) {
  const active = assertClaimOwner(claim);
  if (active.state !== 'active' || active.daemonId !== daemonId) {
    throw new CamoError({
      code: 'E_STATE_LOCKED',
      details: {
        resource: 'shared_daemon',
        daemonId,
        activeDaemonId: active.daemonId || null,
      },
    });
  }
  fs.unlinkSync(claimPath());
  return true;
}
