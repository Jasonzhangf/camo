#!/usr/bin/env node
/**
 * Lock manager for browser session lifecycle
 * Prevents multiple instances from conflicting
 */
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from '../utils/config.mjs';

const LOCK_DIR = path.join(CONFIG_DIR, 'locks');

function ensureLockDir() {
  if (!fs.existsSync(LOCK_DIR)) {
    fs.mkdirSync(LOCK_DIR, { recursive: true });
  }
}

export function getLockFile(profileId) {
  return path.join(LOCK_DIR, `${profileId}.lock`);
}

export function getLockInfo(profileId) {
  const lockFile = getLockFile(profileId);
  if (!fs.existsSync(lockFile)) return null;
  
  try {
    const content = fs.readFileSync(lockFile, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function acquireLock(profileId, sessionInfo = {}) {
  ensureLockDir();
  const lockFile = getLockFile(profileId);
  
  const lockData = {
    profileId,
    pid: process.pid,
    startTime: Date.now(),
    ...sessionInfo,
  };
  
  fs.writeFileSync(lockFile, JSON.stringify(lockData, null, 2));
  return lockData;
}

export function releaseLock(profileId) {
  const lockFile = getLockFile(profileId);
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    return true;
  }
  return false;
}

export function isLocked(profileId) {
  const lockFile = getLockFile(profileId);
  return fs.existsSync(lockFile);
}

export function cleanupStaleLocks() {
  ensureLockDir();
  const files = fs.readdirSync(LOCK_DIR);
  const now = Date.now();
  const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours
  
  let cleaned = 0;
  for (const file of files) {
    if (!file.endsWith('.lock')) continue;
    
    const lockFile = path.join(LOCK_DIR, file);
    try {
      const stats = fs.statSync(lockFile);
      const age = now - stats.mtimeMs;
      
      if (age > staleThreshold) {
        fs.unlinkSync(lockFile);
        cleaned++;
        continue;
      }
      
      const content = fs.readFileSync(lockFile, 'utf-8');
      const lockData = JSON.parse(content);
      
      // Check if process is still alive
      if (lockData.pid) {
        try {
          process.kill(lockData.pid, 0); // Signal 0 checks existence
        } catch {
          // Process not running, lock is stale
          fs.unlinkSync(lockFile);
          cleaned++;
        }
      }
    } catch (err) {
      // Corrupted lock file, remove it
      try {
        fs.unlinkSync(lockFile);
        cleaned++;
      } catch {}
    }
  }
  
  return cleaned;
}

export function listActiveLocks() {
  ensureLockDir();
  const files = fs.readdirSync(LOCK_DIR);
  const locks = [];
  
  for (const file of files) {
    if (!file.endsWith('.lock')) continue;
    const profileId = file.replace('.lock', '');
    const info = getLockInfo(profileId);
    if (info) locks.push({ profileId, ...info });
  }
  
  return locks;
}
