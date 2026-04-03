import os from 'node:os';
import { spawnSync } from 'node:child_process';

function isProcessAlive(pid) {
  const target = Number(pid);
  if (!Number.isFinite(target) || target <= 0) return false;
  try {
    process.kill(target, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcess(pid) {
  const target = Number(pid);
  if (!Number.isFinite(target) || target <= 0) return false;
  try {
    process.kill(target, 'SIGTERM');
  } catch {}
  const start = Date.now();
  while (Date.now() - start < 1500) {
    if (!isProcessAlive(target)) return true;
  }
  try {
    process.kill(target, 'SIGKILL');
  } catch {}
  return !isProcessAlive(target);
}

function listCamoufoxPidsByProfile(profileDir) {
  const dir = String(profileDir || '').trim();
  if (!dir) return [];
  if (os.platform() === 'win32') {
    const escaped = dir.replace(/\\/g, '\\\\');
    const script = [
      `$target='${escaped.replace(/'/g, "''")}'`,
      `$items=Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'camoufox*' -and $_.CommandLine -like \"*$target*\" } | Select-Object ProcessId`,
      `$items | ConvertTo-Json -Compress`,
    ].join('; ');
    const res = spawnSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (res.status !== 0 || !res.stdout) return [];
    try {
      const parsed = JSON.parse(res.stdout.trim());
      const list = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      return list
        .map((item) => Number(item?.ProcessId))
        .filter((pid) => Number.isFinite(pid) && pid > 0);
    } catch {
      return [];
    }
  }

  const res = spawnSync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], { encoding: 'utf8' });
  if (res.status !== 0 || !res.stdout) return [];
  const needle = dir.toLowerCase();
  return res.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const space = line.indexOf(' ');
      if (space <= 0) return null;
      const pid = Number(line.slice(0, space).trim());
      const cmd = line.slice(space + 1).toLowerCase();
      if (!cmd.includes('camoufox')) return null;
      if (!cmd.includes(needle)) return null;
      return pid;
    })
    .filter((pid) => Number.isFinite(pid) && pid > 0);
}

export function cleanupOrphanedProfileProcesses(profileDir, profileId) {
  const pids = listCamoufoxPidsByProfile(profileDir);
  if (!pids.length) return { ok: true, profileId, cleaned: 0 };
  let cleaned = 0;
  for (const pid of pids) {
    if (killProcess(pid)) cleaned += 1;
  }
  return { ok: true, profileId, cleaned };
}
