#!/usr/bin/env node
// Cross-platform test entrypoint. Node's test runner does not consistently
// expand quoted glob patterns across Node 20/22 and operating systems.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUITES = {
  default: ['v2/tests/unit', 'v2/tests/smoke'],
  unit: ['v2/tests/unit'],
  smoke: ['v2/tests/smoke'],
  integration: ['v2/tests/integration'],
  e2e: ['v2/tests/e2e'],
  all: [
    'v2/tests/unit',
    'v2/tests/smoke',
    'v2/tests/integration',
    'v2/tests/e2e',
  ],
};

function collectTests(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(fullPath);
    }
  }
  return files;
}

const suite = process.argv[2] || 'default';
const roots = SUITES[suite];
if (!roots) {
  console.error(`Unknown test suite: ${suite}`);
  process.exit(1);
}

const files = roots
  .flatMap((root) => collectTests(path.join(REPO_ROOT, root)))
  .sort();

if (files.length === 0) {
  console.error(`No test files found for suite: ${suite}`);
  process.exit(1);
}

// Windows caps the whole command line near 32K characters, so a suite's worth
// of absolute paths cannot go into one child process. Batch by estimated
// length and fail the run if any batch fails.
const MAX_BATCH_CHARS = 20_000;
const batches = [];
let current = [];
let currentChars = '--test'.length;
for (const file of files) {
  if (current.length > 0 && currentChars + file.length + 1 > MAX_BATCH_CHARS) {
    batches.push(current);
    current = [];
    currentChars = '--test'.length;
  }
  current.push(file);
  currentChars += file.length + 1;
}
if (current.length > 0) batches.push(current);

let failed = false;
for (const batch of batches) {
  const result = spawnSync(process.execPath, ['--test', ...batch], {
    cwd: REPO_ROOT,
    env: { ...process.env, CAMO_PKG_ROOT: REPO_ROOT },
    stdio: 'inherit',
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
