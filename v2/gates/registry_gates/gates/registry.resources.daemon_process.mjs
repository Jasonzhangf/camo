#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { executeProhibitions, PALETTE, V1_ROOT } from './_helpers.mjs';

const { ok, violations, resource } = executeProhibitions('daemon_process');
const checks = [...violations];
const ownerSource = fs.readFileSync(
  path.join(V1_ROOT, 'v2/services/daemon_process/spawn.mjs'),
  'utf8',
);

if (!/stdio:\s*['"]ignore['"]/.test(ownerSource)) {
  checks.push('daemon process owner must use parent-independent ignored stdio');
}
if (!/detached:\s*true/.test(ownerSource)) {
  checks.push('daemon process owner must detach the child');
}

for (const relativePath of [
  'v2/commands/builtins/daemon.mjs',
  'v2/shell/bin_entry/index.mjs',
]) {
  const source = fs.readFileSync(path.join(V1_ROOT, relativePath), 'utf8');
  if (/from ['"]node:child_process['"]/.test(source) || /\bspawn\s*\(/.test(source)) {
    checks.push(`${relativePath} owns a forbidden direct daemon spawn`);
  }
  if (!/spawnDaemonProcess/.test(source)) {
    checks.push(`${relativePath} does not call the daemon process owner`);
  }
}

if (!ok || checks.length > 0) {
  console.error(`[${PALETTE.fail}] registry.resources.daemon_process: ${checks.join('; ')}`);
  process.exit(1);
}
console.log(`[${PALETTE.pass}] registry.resources.daemon_process: executable prohibitions pass`);
console.log(`         status=${resource.status} policy=${resource.policy_id}`);
