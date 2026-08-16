#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PALETTE } from './_helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const v2Root = path.resolve(here, '..', '..', '..');
const legacyRuntime = path.join(v2Root, 'core', 'browser', 'CookieStore.mjs');
const compatibility = path.join(v2Root, 'core', 'browser', 'CookieStore.ts');
const expected = "// Compatibility projection. Runtime ownership lives in services/profile.\nexport { CookieStore, getCookieStore } from '../../services/profile/cookie_store.mjs';\n";

const failures = [];
if (fs.existsSync(legacyRuntime)) failures.push('legacy runtime implementation still exists');
if (!fs.existsSync(compatibility) || fs.readFileSync(compatibility, 'utf8') !== expected) {
  failures.push('TypeScript compatibility surface is not a thin exact re-export');
}

if (failures.length > 0) {
  console.error(`[${PALETTE.fail}] registry.resources.profile_cookie_backup: ${failures.join('; ')}`);
  process.exit(1);
}

console.log(`[${PALETTE.pass}] registry.resources.profile_cookie_backup: single runtime owner enforced`);
