#!/usr/bin/env node
// v2 build: no transpile step yet. Keep the entry points executable so
// `npm run install:global` produces a working shim. Stage 6 strips the
// `src/` directory; v2/ sources are consumed directly from the repo.
import { chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const binDir = path.join(root, 'bin');
mkdirSync(binDir, { recursive: true });

for (const name of ['camo', 'camo.mjs']) {
  const p = path.join(binDir, name);
  chmodSync(p, 0o755);
}

console.log('Build: bin/camo and bin/camo.mjs ready');
