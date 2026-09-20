#!/usr/bin/env node
// Per-resource gate for resource_id=browser_target.

import { checkForbiddenGone, PALETTE, getResource } from './_helpers.mjs';

const r = getResource('browser_target');
const { ok, hits } = checkForbiddenGone('browser_target');

if (ok) {
  console.log(`[${PALETTE.pass}] registry.resources.browser_target: forbidden_paths have no v1 shadows`);
  console.log(`         status=${r.status || 'design'} policy=${r.policy_id}`);
  process.exit(0);
}

console.error(`[${PALETTE.fail}] registry.resources.browser_target: v1 leftovers for forbidden_paths:`);
for (const h of hits) console.error(`  - ${h}`);
process.exit(1);
