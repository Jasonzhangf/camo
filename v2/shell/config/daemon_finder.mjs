// Compatibility read surface. Canonical daemon truth is owned by
// services.daemon_registration; this module never scans or mutates files.
import {
  findActiveDaemon as findSharedDaemon,
} from '../../services/daemon_registration/registry.mjs';

/**
 * Find an active daemon.
 * @param {Object} opts
 * @param {string} opts.profile - Filter by profile (optional)
 * @param {boolean} opts.ephemeral - Include ephemeral daemons (default false)
 * @returns {Object|null} { daemonId, pid, wsPort, httpPort, profile, mode, startedAt } or null
 */
export function findActiveDaemon(opts = {}) {
  return findSharedDaemon({ pid: opts.pid });
}

/**
 * Check if a daemon exists for a specific profile.
 */
export function hasActiveDaemon(profile) {
  return findActiveDaemon({ profile, ephemeral: true }) !== null;
}
