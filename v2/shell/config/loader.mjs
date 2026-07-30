// camo v2 config loader. Module id=shell.config.
//
// Loads configuration from multiple sources with priority:
// 1. CLI overrides (highest)
// 2. Environment variables
// 3. Config file (~/.camo/config.json)
// 4. Defaults (lowest)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';

const CONFIG_FILE = path.join(os.homedir(), '.camo', 'config.json');

const DEFAULT_CONFIG = {
  profile: 'default',
  logLevel: 'info',
  wsUrl: 'ws://localhost:8765',
  httpUrl: 'http://localhost:8766',
  timeout: 30000,
  headless: false,
  debug: false,
  trace: false,
};

export function loadConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG };

  // Load from config file if exists (layer 3)
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      Object.assign(config, fileConfig);
    } catch (err) {
      throw new CamoError({
        code: 'E_CONFIG_INVALID',
        details: { file: CONFIG_FILE, reason: err.message },
      });
    }
  }

  // Apply environment overrides (layer 2)
  if (process.env.CAMO_PROFILE)    config.profile   = process.env.CAMO_PROFILE;
  if (process.env.CAMO_LOG_LEVEL)  config.logLevel  = process.env.CAMO_LOG_LEVEL;
  if (process.env.CAMO_WS_URL)    config.wsUrl     = process.env.CAMO_WS_URL;
  if (process.env.CAMO_HTTP_URL)   config.httpUrl   = process.env.CAMO_HTTP_URL;
  if (process.env.CAMO_TIMEOUT)   config.timeout   = parseInt(process.env.CAMO_TIMEOUT, 10);
  if (process.env.CAMO_DEBUG)      config.debug     = process.env.CAMO_DEBUG === '1';
  if (process.env.CAMO_TRACE)      config.trace     = process.env.CAMO_TRACE === '1';

  // Apply CLI overrides (layer 1, highest priority)
  Object.assign(config, overrides);

  return config;
}

export function getDefault(key) {
  return DEFAULT_CONFIG[key];
}

export const CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
export { CONFIG_FILE };
