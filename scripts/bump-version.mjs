#!/usr/bin/env node
/**
 * Version bumper for camo CLI.
 * Increments standard semver patch version (0.1.21 -> 0.1.22).
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageLockPath = join(__dirname, '..', 'package-lock.json');

function bumpVersion() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const currentVersion = pkg.version;
  const parts = currentVersion.split('.');
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  let patch = parseInt(parts[2], 10);

  patch += 1;

  const newVersion = `${major}.${minor}.${patch}`;
  
  pkg.version = newVersion;
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');

  try {
    const lock = JSON.parse(readFileSync(packageLockPath, 'utf-8'));
    lock.version = newVersion;
    if (lock.packages?.['']) lock.packages[''].version = newVersion;
    writeFileSync(packageLockPath, JSON.stringify(lock, null, 2) + '\n');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  
  console.log(`Version bumped: ${currentVersion} -> ${newVersion}`);
  return newVersion;
}

bumpVersion();
