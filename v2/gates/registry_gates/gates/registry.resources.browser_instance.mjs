#!/usr/bin/env node
import { executeProhibitions, PALETTE } from './_helpers.mjs';

const { ok, violations, resource } = executeProhibitions('browser_instance');
if (!ok) {
  console.error(`[${PALETTE.fail}] registry.resources.browser_instance: ${violations.join('; ')}`);
  process.exit(1);
}
console.log(`[${PALETTE.pass}] registry.resources.browser_instance: executable prohibitions pass`);
console.log(`         status=${resource.status} policy=${resource.policy_id}`);
