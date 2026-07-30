// camo v2 shell CLI dispatcher. Module id=shell.cli.
//
// The L5 entry point. argv -> infer cmd -> parse flags -> run builtin
// with an injected transport. No automatic transport fallback (hard guard #3).
//
// Hard guards:
//   - Single source of arg parsing (parsers/flags.mjs).
//   - Single source of cmd registry (commands/registry/registry.mjs).
//   - No direct service imports (forbidden edge per registry edges.json).
//   - Transport must be explicitly injected; no fallback.
//   - help/doctor/usage paths bypass transport requirement.
//   - Input errors (E_INPUT_*) are reported before transport errors.

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { infer as inferCmd, parse as parseFlags } from '../../commands/parsers/flags.mjs';
import { list as registryList } from '../../commands/registry/registry.mjs';
import { run as runBuiltin } from '../../commands/builtins/index.mjs';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DOC_DIR = path.resolve(__dirname, '../../commands/docstrings');

function readDocstring(cmd) {
  const file = path.join(DOC_DIR, cmd + '.md');
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file, 'utf8');
}

export async function dispatch(argv, opts = {}) {
  if (!Array.isArray(argv)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'argv' } });
  }

  // Help / doctor — no transport needed
  if (argv[0] === '--help' || argv[0] === '-h' || argv[0] === 'help') {
    return { kind: 'help', usage: usage() };
  }
  if (argv[0] === 'doctor') {
    const { run: runDoctor } = await import('../doctor/check.mjs');
    return { kind: 'doctor', report: runDoctor() };
  }

  // Parse input before checking transport (input errors take priority).
  const cmd = inferCmd(argv, null);
  if (!cmd) {
    return { kind: 'usage', usage: usage() };
  }
  const rest = argv.slice(1);
  const parsed = parseFlags(rest, { cmd });
  if (parsed.help) {
    return { kind: 'help', cmd, usage: readDocstring(cmd) };
  }
  if ((parsed.errors || []).length > 0) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { cmd, errors: parsed.errors, missing_required: parsed.missing_required },
    });
  }
  if ((parsed.missing_required || []).length > 0) {
    throw new CamoError({
      code: 'E_INPUT_MISSING_FIELD',
      details: { cmd, missing_required: parsed.missing_required },
    });
  }

  // Transport required for actual command execution.
  if (!opts.transport && !opts.processOnly) {
    throw new CamoError({ code: 'E_STATE_NO_TRANSPORT', details: { reason: 'dispatch requires opts.transport; no fallback' } });
  }

  const ctx = { traceId: opts.traceId || 'cli-' + Date.now() };
  const result = await runBuiltin(cmd, opts.transport, parsed, ctx);
  return { kind: 'result', cmd, result };
}

export function usage() {
  const cmds = registryList();
  return [
    'Usage: camo <cmd> [args]',
    '',
    'Commands:',
    ...cmds.map((c) => '  ' + c),
    '',
    'Other:',
    '  doctor    run environment sanity checks',
    '  --help    print this usage',
  ].join('\n');
}

export function describe() {
  return { moduleId: 'shell.cli', layer: 'L5_shell', role: 'arg dispatch into commands/builtins', cmds: registryList() };
}

// Test seam: build a fake in-process transport for unit tests.
// This is NOT a fallback -- it's an explicit test harness injected by test files.
export function makeFakeTransport() {
  return {
    async sendFrame(env) {
      const { registerHandler, resetRoutes, handleFrame, __enableTestRoot: enable } = await import('../../transports/ws/server.mjs');
      enable();
      const cmdId = env.payload && env.payload.cmd;
      resetRoutes();
      registerHandler('command', async (serverEnv) => ({
        kind: 'result',
        payload: { ...(serverEnv.payload && serverEnv.payload.args), echoed: true, cmd: cmdId },
      }));
      let out;
      await handleFrame({ text: JSON.stringify(env), send: (e) => { out = e; } });
      return out;
    },
  };
}

export function __enableTestRoot() { /* no-op */ }
export function __resetForTest() { /* no-op */ }
