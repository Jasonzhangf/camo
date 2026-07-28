import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const testsDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(testsDir, '..', '..', '..');
const camoBin = path.join(repoRoot, 'bin', 'camo');

test('positive: bin/camo --help exits 0 with usage', () => {
  const out = execFileSync('bash', [camoBin, '--help'], { encoding: 'utf8', stdio: 'pipe' });
  assert.match(out, /Usage: camo/);
});

test('positive: bin/camo doctor prints JSON report', () => {
  const out = execFileSync('bash', [camoBin, 'doctor'], { encoding: 'utf8', stdio: 'pipe' });
  const report = JSON.parse(out);
  assert.equal(report.protocol, 'camo.v2.protocol/v1');
  assert.ok(report.registry.commands >= 6);
});

test('positive: bin/camo click --help prints command docstring', () => {
  const out = execFileSync('bash', [camoBin, 'click', '--help'], { encoding: 'utf8', stdio: 'pipe' });
  assert.match(out, /exactly one of .selector. or .text./i);
});

test('positive: bin/camo goto without url exits with code 2', () => {
  let exitCode = 0;
  try {
    execFileSync('bash', [camoBin, 'goto'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (err) {
    exitCode = err.status || 1;
  }
  assert.equal(exitCode, 2, 'camo goto without url must exit 2 (E_INPUT_MISSING_FIELD)');
});

test('positive: bin/camo uses v2 path', () => {
  // Sanity: bin/camo must point at v2/shell/bin_entry; we check by running --help
  // and confirming the camo.v2.protocol/v1 string surfaces in doctor.
  const doctor = JSON.parse(execFileSync('bash', [camoBin, 'doctor'], { encoding: 'utf8', stdio: 'pipe' }));
  assert.match(doctor.protocol, /camo\.v2\.protocol\/v1/);
});
