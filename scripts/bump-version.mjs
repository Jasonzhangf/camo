#!/usr/bin/env node
/**
 * Version bumper for camo CLI
 * Increments patch version maintaining 4-digit format (0.1.0001 -> 0.1.0002)
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');

function bumpVersion() {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const currentVersion = pkg.version;
  
  // Parse version: 0.1.0001 -> [0, 1, 1]
  const parts = currentVersion.split('.');
  const major = parseInt(parts[0], 10);
  const minor = parseInt(parts[1], 10);
  let patch = parseInt(parts[2], 10);
  
  // Increment patch
  patch += 1;
  
  // Format with 4 digits
  const newVersion = `${major}.${minor}.${patch.toString().padStart(4, '0')}`;
  
  pkg.version = newVersion;
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  
  console.log(`Version bumped: ${currentVersion} -> ${newVersion}`);
  return newVersion;
}

bumpVersion();
