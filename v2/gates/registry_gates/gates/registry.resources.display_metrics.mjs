#!/usr/bin/env node
// Per-resource gate for resource_id=display_metrics. CI invokes this via the
// registry resources-coverage gate run when the resource's status is
// "active". While status is "design" we still print the evidence so
// humans can see v1 leftovers.

import { checkForbiddenGone, PALETTE, getResource } from './_helpers.mjs';

const r = getResource('display_metrics');
const { ok, hits } = checkForbiddenGone('display_metrics');

if (ok) {
  console.log(`[${PALETTE.pass}] registry.resources.display_metrics: forbidden_paths have no v1 shadows`);
  console.log(`         status=${r.status || 'design'} policy=${r.policy_id}`);
  process.exit(0);
}

console.error(`[${PALETTE.fail}] registry.resources.display_metrics: v1 leftovers for forbidden_paths:`);
for (const h of hits) console.error(`  - ${h}`);
console.error(`         fix: remove the v1 file(s) or stub them with import-gate; then this gate is green`);
console.error(`         only then may resource flip to status=active`);
process.exit(1);
