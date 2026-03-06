#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../src/services/browser-service/index.js');

const mod = await import(entry);
if (typeof mod.runBrowserServiceCli === 'function') {
  await mod.runBrowserServiceCli(process.argv);
}
