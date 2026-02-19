#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listProfiles, getDefaultProfile, loadConfig, hasStartScript, setRepoRoot } from './utils/config.mjs';
import { printHelp, printProfilesAndHint } from './utils/help.mjs';
import { handleProfileCommand } from './commands/profile.mjs';
import { handleInitCommand } from './commands/init.mjs';
import { handleCreateCommand } from './commands/create.mjs';
import { handleCookiesCommand } from './commands/cookies.mjs';
import { handleWindowCommand } from './commands/window.mjs';
import { handleMouseCommand } from './commands/mouse.mjs';
import { handleSystemCommand } from './commands/system.mjs';
import { handleContainerCommand } from './commands/container.mjs';
import { handleAutoscriptCommand } from './commands/autoscript.mjs';
import { handleEventsCommand } from './commands/events.mjs';
import { handleDevtoolsCommand } from './commands/devtools.mjs';
import { handleRecordCommand } from './commands/record.mjs';
import { handleHighlightModeCommand } from './commands/highlight-mode.mjs';
import {
  handleStartCommand, handleStopCommand, handleStatusCommand,
  handleGotoCommand, handleBackCommand, handleScreenshotCommand,
  handleScrollCommand, handleClickCommand, handleTypeCommand,
  handleHighlightCommand, handleClearHighlightCommand, handleViewportCommand,
  handleNewPageCommand, handleClosePageCommand, handleSwitchPageCommand,
  handleListPagesCommand, handleShutdownCommand
} from './commands/browser.mjs';
import {
  handleCleanupCommand, handleForceStopCommand, handleLockCommand,
 handleUnlockCommand, handleSessionsCommand, handleInstancesCommand
} from './commands/lifecycle.mjs';
import { handleSessionWatchdogCommand } from './lifecycle/session-watchdog.mjs';
import { safeAppendProgressEvent } from './events/progress-log.mjs';
import { ensureProgressEventDaemon } from './events/daemon.mjs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const START_SCRIPT_REL = path.join('runtime', 'infra', 'utils', 'scripts', 'service', 'start-browser-service.mjs');

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function inferProfileId(cmd, args) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  if (explicitProfile) return explicitProfile;
  const positionals = args.slice(1).filter((item) => item && !String(item).startsWith('-'));
  if (positionals.length === 0) return null;

  if ([
    'start', 'stop', 'status', 'list', 'goto', 'navigate', 'back', 'screenshot',
    'scroll', 'click', 'type', 'highlight', 'clear-highlight', 'viewport',
    'new-page', 'close-page', 'switch-page', 'list-pages',
    'cleanup', 'force-stop', 'lock', 'unlock', 'sessions',
  ].includes(cmd)) {
    if ((cmd === 'stop' || cmd === 'close') && (args.includes('--id') || args.includes('--alias'))) {
      return null;
    }
    const first = positionals[0] || null;
    if ((cmd === 'stop' || cmd === 'close') && (first === 'all' || first === 'idle')) {
      return null;
    }
    return positionals[0] || null;
  }

  if (cmd === 'devtools') {
    const sub = positionals[0] || null;
    if (sub === 'eval' || sub === 'logs' || sub === 'clear') {
      return positionals[1] || null;
    }
  }

  if (cmd === 'record') {
    const explicit = readFlagValue(args, ['--profile', '-p']);
    if (explicit) return explicit;
    const sub = positionals[0] || null;
    const values = [];
    for (let i = 2; i < args.length; i += 1) {
      const token = args[i];
      if (!token || String(token).startsWith('-')) continue;
      const prev = args[i - 1];
      if (prev && ['--name', '--output', '--reason'].includes(prev)) continue;
      values.push(String(token));
    }
    if (sub === 'start' || sub === 'stop' || sub === 'status') {
      return values[0] || null;
    }
  }

  if (cmd === 'autoscript' && positionals[0] === 'run') {
    return explicitProfile || null;
  }

  if (cmd === 'container' && ['watch', 'filter', 'list', 'targets', 'register'].includes(positionals[0])) {
    return positionals[1] || null;
  }

  return null;
}

async function runTrackedCommand(cmd, args, fn) {
  const startedAt = Date.now();
  const profileId = inferProfileId(cmd, args);
  safeAppendProgressEvent({
    source: 'cli.command',
    mode: cmd === 'autoscript' ? 'autoscript' : 'normal',
    profileId,
    event: 'cli.command_start',
    payload: { cmd, args: args.slice(1), startedAt },
  });
  try {
    const result = await fn();
    safeAppendProgressEvent({
      source: 'cli.command',
      mode: cmd === 'autoscript' ? 'autoscript' : 'normal',
      profileId,
      event: 'cli.command_done',
      payload: { cmd, args: args.slice(1), startedAt, endedAt: Date.now(), durationMs: Date.now() - startedAt },
    });
    return result;
  } catch (err) {
    safeAppendProgressEvent({
      source: 'cli.command',
      mode: cmd === 'autoscript' ? 'autoscript' : 'normal',
      profileId,
      event: 'cli.command_error',
      payload: {
        cmd,
        args: args.slice(1),
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        error: err?.message || String(err),
      },
    });
    throw err;
  }
}

async function handleConfigCommand(args) {
  const sub = args[1];
  if (sub !== 'repo-root') {
    throw new Error('Usage: camo config repo-root [path]');
  }
  const repoRoot = args[2];
  if (!repoRoot) {
    console.log(JSON.stringify({ ok: true, repoRoot: loadConfig().repoRoot }, null, 2));
    return;
  }
  const resolved = path.resolve(repoRoot);
  if (!hasStartScript(resolved)) {
    throw new Error(`Invalid repo root: ${resolved} (missing ${START_SCRIPT_REL})`);
  }
  setRepoRoot(resolved);
  console.log(JSON.stringify({ ok: true, repoRoot: resolved }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd) {
    printProfilesAndHint(listProfiles, getDefaultProfile);
    return;
  }

  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (cmd === '__session-watchdog') {
    await handleSessionWatchdogCommand(args);
    return;
  }

  const skipProgressAutoStart = new Set(['help', '--help', '-h', 'profiles', 'events', '__session-watchdog']);
  if (!skipProgressAutoStart.has(cmd)) {
    try {
      await ensureProgressEventDaemon();
    } catch {
      // Progress daemon auto-start is best-effort and must not block command execution.
    }
  }

  if (cmd === 'profiles') {
    const profiles = listProfiles();
    const defaultProfile = getDefaultProfile();
    console.log(JSON.stringify({ ok: true, profiles, defaultProfile, count: profiles.length }, null, 2));
    return;
  }

  if (cmd === 'profile') {
    await runTrackedCommand(cmd, args, () => handleProfileCommand(args));
    return;
  }

  if (cmd === 'config') {
    await runTrackedCommand(cmd, args, () => handleConfigCommand(args));
    return;
  }

  if (cmd === 'init') {
    await runTrackedCommand(cmd, args, () => handleInitCommand(args));
    return;
  }

  if (cmd === 'create') {
    await runTrackedCommand(cmd, args, () => handleCreateCommand(args));
    return;
  }

  if (cmd === 'events') {
    await runTrackedCommand(cmd, args, () => handleEventsCommand(args));
    return;
  }

  if (cmd === 'devtools') {
    await runTrackedCommand(cmd, args, () => handleDevtoolsCommand(args));
    return;
  }

  if (cmd === 'record') {
    await runTrackedCommand(cmd, args, () => handleRecordCommand(args));
    return;
  }

  if (cmd === 'highlight-mode') {
    await runTrackedCommand(cmd, args, () => handleHighlightModeCommand(args));
    return;
  }

  // Lifecycle commands
  if (cmd === 'cleanup') {
    await runTrackedCommand(cmd, args, () => handleCleanupCommand(args));
    return;
  }

  if (cmd === 'force-stop') {
    await runTrackedCommand(cmd, args, () => handleForceStopCommand(args));
    return;
  }

  if (cmd === 'lock') {
    await runTrackedCommand(cmd, args, () => handleLockCommand(args));
    return;
  }

  if (cmd === 'unlock') {
    await runTrackedCommand(cmd, args, () => handleUnlockCommand(args));
    return;
  }

  if (cmd === 'sessions') {
    await runTrackedCommand(cmd, args, () => handleSessionsCommand(args));
    return;
  }

  if (cmd === 'instances') {
    await runTrackedCommand(cmd, args, () => handleInstancesCommand(args));
    return;
  }

  if (cmd === 'container') {
    await runTrackedCommand(cmd, args, () => handleContainerCommand(args));
    return;
  }

  if (cmd === 'autoscript') {
    await runTrackedCommand(cmd, args, () => handleAutoscriptCommand(args));
    return;
  }

  const serviceCommands = new Set([
    'start', 'stop', 'close', 'status', 'list', 'goto', 'navigate', 'back', 'screenshot',
    'new-page', 'close-page', 'switch-page', 'list-pages', 'shutdown',
    'scroll', 'click', 'type', 'highlight', 'clear-highlight', 'viewport',
    'cookies', 'window', 'mouse', 'system', 'container', 'autoscript', 'events', 'devtools', 'record', 'highlight-mode',
  ]);

  if (!serviceCommands.has(cmd)) {
    throw new Error(`Unknown command: ${cmd}`);
  }

  await runTrackedCommand(cmd, args, async () => {
    switch (cmd) {
      case 'start':
        await handleStartCommand(args);
        break;
      case 'stop':
      case 'close':
        await handleStopCommand(args);
        break;
      case 'status':
      case 'list':
        await handleStatusCommand(args);
        break;
      case 'goto':
      case 'navigate':
        await handleGotoCommand(args);
        break;
      case 'back':
        await handleBackCommand(args);
        break;
      case 'screenshot':
        await handleScreenshotCommand(args);
        break;
      case 'scroll':
        await handleScrollCommand(args);
        break;
      case 'click':
        await handleClickCommand(args);
        break;
      case 'type':
        await handleTypeCommand(args);
        break;
      case 'highlight':
        await handleHighlightCommand(args);
        break;
      case 'clear-highlight':
        await handleClearHighlightCommand(args);
        break;
      case 'viewport':
        await handleViewportCommand(args);
        break;
      case 'new-page':
        await handleNewPageCommand(args);
        break;
      case 'close-page':
        await handleClosePageCommand(args);
        break;
      case 'switch-page':
        await handleSwitchPageCommand(args);
        break;
      case 'list-pages':
        await handleListPagesCommand(args);
        break;
      case 'shutdown':
        await handleShutdownCommand();
        break;
      case 'cookies':
        await handleCookiesCommand(args);
        break;
      case 'window':
        await handleWindowCommand(args);
        break;
      case 'mouse':
        await handleMouseCommand(args);
        break;
      case 'system':
        await handleSystemCommand(args);
        break;
      case 'record':
        await handleRecordCommand(args);
        break;
      case 'highlight-mode':
        await handleHighlightModeCommand(args);
        break;
    }
  });
}

main().catch((err) => {
  console.error(`Error: ${err?.message || String(err)}`);
  process.exit(1);
});
