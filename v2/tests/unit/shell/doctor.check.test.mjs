import { test } from 'node:test';
import assert from 'node:assert/strict';

import { run, describe } from '../../../shell/doctor/check.mjs';

test('positive: run returns structured report', () => {
  const r = run();
  assert.match(r.node, /^v\d+\./);
  assert.equal(r.protocol, 'camo.v2.protocol/v1');
  assert.ok(r.registry.commands >= 6);
  assert.ok(typeof r.registry.docstrings === 'number');
  assert.ok(r.registry.tests > 0);
  assert.ok(Array.isArray(r.v1_leftovers));
  assert.match(r.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('positive: ci_mode reflects CAMO_V2_STRICT env var', () => {
  process.env.CAMO_V2_STRICT = '1';
  const r = run();
  assert.equal(r.ci_mode, 'strict');
  delete process.env.CAMO_V2_STRICT;
});

test('positive: ci_mode defaults to non-strict', () => {
  delete process.env.CAMO_V2_STRICT;
  const r = run();
  assert.equal(r.ci_mode, 'non-strict');
});

test('utility: describe module is L5_shell', () => {
  const d = describe();
  assert.equal(d.layer, 'L5_shell');
  assert.equal(d.moduleId, 'shell.doctor');
});
