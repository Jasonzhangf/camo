#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { listProfiles, getDefaultProfile, loadConfig, hasStartScript, setRepoRoot } from './utils/config.mjs';
import { ensureCamoufox, ensureBrowserService } from './utils/browser-service.mjs';
import { printHelp, printProfilesAndHint } from './utils/help.mjs';
import { handleProfileCommand } from './commands/profile.mjs';
import { handleInitCommand } from './commands/init.mjs';
import { handleCreateCommand } from './commands/create.mjs';
import { handleCookiesCommand } from './commands/cookies.mjs';
import { handleWindowCommand } from './commands/window.mjs';
import { handleMouseCommand } from './commands/mouse.mjs';
import { handleSystemCommand } from './commands/system.mjs';
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
 handleUnlockCommand, handleSessionsCommand
} from './commands/lifecycle.mjs';

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const START_SCRIPT_REL = path.join('runtime', 'infra', 'utils', 'scripts', 'service', 'start-browser-service.mjs');

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

  if (cmd === 'profiles') {
    const profiles = listProfiles();
    const defaultProfile = getDefaultProfile();
    console.log(JSON.stringify({ ok: true, profiles, defaultProfile, count: profiles.length }, null, 2));
    return;
  }

  if (cmd === 'profile') {
    await handleProfileCommand(args);
    return;
  }

  if (cmd === 'config') {
    await handleConfigCommand(args);
    return;
  }

  if (cmd === 'init') {
    await handleInitCommand(args);
    return;
  }

  if (cmd === 'create') {
    await handleCreateCommand(args);
    return;
  }

  // Lifecycle commands
  if (cmd === 'cleanup') {
    await handleCleanupCommand(args);
    return;
  }

  if (cmd === 'force-stop') {
    await handleForceStopCommand(args);
    return;
  }

  if (cmd === 'lock') {
    await handleLockCommand(args);
    return;
  }

  if (cmd === 'unlock') {
    await handleUnlockCommand(args);
    return;
  }

  if (cmd === 'sessions') {
    await handleSessionsCommand(args);
    return;
  }

  const serviceCommands = new Set([
    'start', 'stop', 'close', 'status', 'list', 'goto', 'navigate', 'back', 'screenshot',
    'new-page', 'close-page', 'switch-page', 'list-pages', 'shutdown',
    'scroll', 'click', 'type', 'highlight', 'clear-highlight', 'viewport',
    'cookies', 'window', 'mouse', 'system',
  ]);

  if (!serviceCommands.has(cmd)) {
    throw new Error(`Unknown command: ${cmd}`);
  }

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
  }
}

main().catch((err) => {
  console.error(`Error: ${err?.message || String(err)}`);
  process.exit(1);
});
