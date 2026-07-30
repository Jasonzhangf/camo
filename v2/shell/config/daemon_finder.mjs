// Daemon discovery module. Part of shell.config.
//
// Scans ~/.camo/daemon/ for active daemon registrations.
// Returns the most recently started daemon for a given profile,
// or the most recent overall if no profile filter.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAEMON_DIR = path.join(os.homedir(), '.camo', 'daemon');

function isProcessAlive(pid) {
  const p = Number(pid);
  if (!Number.isFinite(p) || p <= 0) return false;
  try { process.kill(p, 0); return true; } catch { return false; }
}

/**
 * Find an active daemon.
 * @param {Object} opts
 * @param {string} opts.profile - Filter by profile (optional)
 * @param {boolean} opts.ephemeral - Include ephemeral daemons (default false)
 * @returns {Object|null} { daemonId, pid, wsPort, httpPort, profile, mode, startedAt } or null
 */
export function findActiveDaemon(opts = {}) {
  if (!fs.existsSync(DAEMON_DIR)) return null;
  
  const entries = fs.readdirSync(DAEMON_DIR);
  let candidates = [];
  
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(DAEMON_DIR, entry);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!raw.pid || !raw.wsPort) continue;
      
      // Filter by profile
      if (opts.profile && raw.profile !== opts.profile) continue;
      
      // Filter ephemeral unless explicitly included
      if (!opts.ephemeral && raw.profile && raw.profile.startsWith('_ephemeral_')) continue;
      
      // Check process alive
      if (!isProcessAlive(raw.pid)) continue;
      
      candidates.push(raw);
    } catch {}
  }
  
  if (candidates.length === 0) return null;
  
  // Sort by startedAt descending, return most recent
  candidates.sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
  return candidates[0];
}

/**
 * Check if a daemon exists for a specific profile.
 */
export function hasActiveDaemon(profile) {
  return findActiveDaemon({ profile, ephemeral: true }) !== null;
}

/**
 * Clean up stale daemon registrations.
 */
export function cleanupStaleRegistrations() {
  if (!fs.existsSync(DAEMON_DIR)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(DAEMON_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(DAEMON_DIR, entry);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!isProcessAlive(raw.pid)) {
        fs.unlinkSync(file);
        count++;
      }
    } catch {}
  }
  return count;
}

export function unregisterByPid(pid) {
  if (!fs.existsSync(DAEMON_DIR)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(DAEMON_DIR)) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(DAEMON_DIR, entry);
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw.pid === pid) {
        fs.unlinkSync(file);
        count++;
      }
    } catch {}
  }
  return count;
}
