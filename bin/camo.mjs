#!/usr/bin/env node
// camo v2 entry shim — delegates to v2/shell/bin_entry/index.mjs.
// This replaces the v1 spawn-into-src/cli.mjs path.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const v2Entry = path.join(__dirname, '..', 'v2', 'shell', 'bin_entry', 'index.mjs');

const child = spawn(process.execPath, [v2Entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (err) => {
  console.error(`Failed to start camo: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
