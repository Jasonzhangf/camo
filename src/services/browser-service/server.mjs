#!/usr/bin/env node
import { parseArgs, startBrowserService } from './index.js';

if (import.meta.url === `file://${process.argv[1]}`) {
  await startBrowserService(parseArgs(process.argv));
}
