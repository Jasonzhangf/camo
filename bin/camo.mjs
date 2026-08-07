#!/usr/bin/env node
// camo v2 entry shim — delegates to v2/shell/bin_entry/index.mjs.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Package root is the parent of 'bin/'
const BIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(BIN_DIR, '..');
const v2Entry = path.join(PKG_ROOT, 'v2', 'shell', 'bin_entry', 'index.mjs');

// Pass PKG_ROOT via env so child can resolve correctly
const childEnv = { ...process.env, CAMO_PKG_ROOT: PKG_ROOT };

const child = spawn(process.execPath, [v2Entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: childEnv,
});

child.on('error', (err) => {
  console.error(`Failed to start camo: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
