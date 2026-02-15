#!/usr/bin/env node
import { copyFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Ensure bin directory exists
const binDir = path.join(root, 'bin');
try { mkdirSync(binDir, { recursive: true }); } catch {}

// Copy source files to dist (if needed)
// For now, we're running directly from src/

// Make bin/camo.mjs executable
const binFile = path.join(binDir, 'camo.mjs');
chmodSync(binFile, 0o755);
console.log('Build: bin/camo.mjs ready');
