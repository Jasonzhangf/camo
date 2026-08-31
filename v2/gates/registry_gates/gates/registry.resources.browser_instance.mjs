#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { executeProhibitions, PALETTE, V1_ROOT } from './_helpers.mjs';

const { ok, violations, resource } = executeProhibitions('browser_instance');
const checks = [...violations];
const engineSource = fs.readFileSync(
  path.join(V1_ROOT, 'v2/services/browser_service/internal/engine-manager.mjs'),
  'utf8',
);

if (!/\bhumanize:\s*false\b/.test(engineSource) || /\bhumanize:\s*true\b/.test(engineSource)) {
  checks.push('Camoufox native humanization must stay disabled');
}
if (!/\bi_know_what_im_doing:\s*true\b/.test(engineSource) || /\biKnowWhatImDoing\b/.test(engineSource)) {
  checks.push('Camoufox acknowledgement option must use only snake_case');
}

if (!ok || checks.length > 0) {
  console.error(`[${PALETTE.fail}] registry.resources.browser_instance: ${checks.join('; ')}`);
  process.exit(1);
}
console.log(`[${PALETTE.pass}] registry.resources.browser_instance: executable prohibitions pass`);
console.log(`         status=${resource.status} policy=${resource.policy_id}`);
