#!/usr/bin/env node
import { executeProhibitions, PALETTE } from './_helpers.mjs';

const { ok, violations, resource } = executeProhibitions('daemon_registration');
if (!ok) {
  console.error(`[${PALETTE.fail}] registry.resources.daemon_registration: ${violations.join('; ')}`);
  process.exit(1);
}
console.log(`[${PALETTE.pass}] registry.resources.daemon_registration: executable prohibitions pass`);
console.log(`         status=${resource.status} policy=${resource.policy_id}`);
