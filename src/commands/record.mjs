import path from 'node:path';
import { getDefaultProfile } from '../utils/config.mjs';
import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function collectPositionals(args, startIndex = 2) {
  const values = [];
  for (let i = startIndex; i < args.length; i += 1) {
    const token = args[i];
    if (!token || String(token).startsWith('-')) continue;
    const prev = args[i - 1];
    if (prev && ['--profile', '-p', '--name', '--output', '--reason'].includes(prev)) {
      continue;
    }
    values.push(String(token));
  }
  return values;
}

function resolveProfileId(args, startIndex = 2) {
  const explicit = readFlagValue(args, ['--profile', '-p']);
  if (explicit) return explicit;
  const positionals = collectPositionals(args, startIndex);
  if (positionals.length > 0) return positionals[0];
  return getDefaultProfile();
}

function parseOverlayFlag(args) {
  if (args.includes('--no-overlay')) return false;
  if (args.includes('--overlay')) return true;
  return null;
}

async function handleRecordStart(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 2);
  if (!profileId) {
    throw new Error('Usage: camo record start [profileId] [--name <name>] [--output <file>] [--overlay|--no-overlay]');
  }
  if (args.includes('--name') && !readFlagValue(args, ['--name'])) {
    throw new Error('Usage: camo record start [profileId] --name <name>');
  }
  if (args.includes('--output') && !readFlagValue(args, ['--output'])) {
    throw new Error('Usage: camo record start [profileId] --output <file>');
  }
  const name = readFlagValue(args, ['--name']);
  const output = readFlagValue(args, ['--output']);
  const overlay = parseOverlayFlag(args);
  const result = await callAPI('record:start', {
    profileId,
    ...(name ? { name } : {}),
    ...(output ? { outputPath: path.resolve(output) } : {}),
    ...(overlay !== null ? { overlay } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function handleRecordStop(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 2);
  if (!profileId) {
    throw new Error('Usage: camo record stop [profileId]');
  }
  const reason = readFlagValue(args, ['--reason']) || 'manual';
  const result = await callAPI('record:stop', { profileId, reason });
  console.log(JSON.stringify(result, null, 2));
}

async function handleRecordStatus(args) {
  await ensureBrowserService();
  const profileId = resolveProfileId(args, 2);
  if (!profileId) {
    throw new Error('Usage: camo record status [profileId]');
  }
  const result = await callAPI('record:status', { profileId });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleRecordCommand(args) {
  const sub = String(args[1] || '').trim().toLowerCase();
  if (!sub) {
    console.log(`Usage: camo record <start|stop|status> [options]
  camo record start [profileId] [--name <name>] [--output <file>] [--overlay|--no-overlay]
  camo record stop [profileId] [--reason <text>]
  camo record status [profileId]
`);
    return;
  }
  switch (sub) {
    case 'start':
      await handleRecordStart(args);
      return;
    case 'stop':
      await handleRecordStop(args);
      return;
    case 'status':
      await handleRecordStatus(args);
      return;
    default:
      console.log(`Usage: camo record <start|stop|status> [options]
  camo record start [profileId] [--name <name>] [--output <file>] [--overlay|--no-overlay]
  camo record stop [profileId] [--reason <text>]
  camo record status [profileId]
`);
  }
}
