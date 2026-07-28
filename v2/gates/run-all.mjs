#!/usr/bin/env node
// Aggregated gate entry point. Runs:
//   1. v2/gates/registry_gates/run.mjs    (registry integrity)
//   2. every per-resource gate under     gates/registry_gates/gates/

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const registryRunner = path.join(__dirname, 'registry_gates', 'run.mjs');
const perResourceDir  = path.join(__dirname, 'registry_gates', 'gates');

const PALETTE = { fail: '\u001b[31mFAIL\u001b[0m', pass: '\u001b[32mPASS\u001b[0m', warn: '\u001b[33mWARN\u001b[0m' };

const failures = [];
function runStep(name, fn) {
  console.log(`\n=== ${name} ===`);
  try {
    fn();
  } catch (err) {
    console.error(`[${PALETTE.fail}] ${name}: ${err?.message || err}`);
    failures.push(name);
  }
}

runStep('registry integrity', () => {
  execFileSync(process.execPath, [registryRunner], { stdio: 'inherit' });
});

runStep('per-resource gates', () => {
  const files = fs.readdirSync(perResourceDir)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();
  let pass = 0;
  let fail = 0;
  for (const f of files) {
    const full = path.join(perResourceDir, f);
    try {
      execFileSync(process.execPath, [full], { stdio: 'pipe' });
      pass += 1;
    } catch {
      fail += 1;
      // In non-strict mode we surface each failure inline.
      try {
        console.error(`-- ${f} --`);
        execFileSync(process.execPath, [full], { stdio: 'inherit' });
      } catch {}
    }
  }
  console.log(`per-resource: ${pass} pass, ${fail} fail`);
});

if (process.argv.includes('--strict')) {
  console.log('\n=== strict mode ===');
  const files = fs.readdirSync(perResourceDir)
    .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
    .sort();
  for (const f of files) {
    try {
      execFileSync(process.execPath, [path.join(perResourceDir, f)], { stdio: 'pipe' });
    } catch {
      console.error(`[${PALETTE.fail}] ${f}`);
      process.exit(1);
    }
  }
}

console.log('');
if (failures.length === 0) {
  console.log(`[${PALETTE.pass}] registry integrity OK; per-resource gates reported above`);
  process.exit(0);
} else {
  console.error(`[${PALETTE.fail}] ${failures.length} step(s) failed`);
  process.exit(1);
}
