// camo v2 REPL mode. Module id=shell.repl.
//
// Interactive read-eval-print loop for camo commands.

import { CamoError } from '../contracts/error_envelope/projector.mjs';
import { parse as parseFlags } from '../commands/parsers/flags.mjs';
import { list as registryList } from '../commands/registry/registry.mjs';
import { run as runBuiltin } from '../commands/builtins/index.mjs';

const HELP = `
camo REPL — type commands or 'help' for help, 'exit' to quit.

Commands: ${registryList().join(', ')}
`.trim();

export async function startRepl(transport, options = {}) {
  const { readline, history = [] } = options;
  const rl = readline || await createReadline();
  let running = true;

  console.log('camo REPL v2.0.0 (type "exit" to quit, "help" for commands)');
  console.log();

  while (running) {
    try {
      const line = await rl.question('camo> ');
      const trimmed = line.trim();

      if (!trimmed) continue;

      if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'q') {
        console.log('Goodbye!');
        running = false;
        break;
      }

      if (trimmed === 'help' || trimmed === '?') {
        console.log(HELP);
        console.log();
        continue;
      }

      const result = await executeLine(trimmed, transport);
      console.log(formatResult(result));
      console.log();
    } catch (err) {
      console.error(`Error: ${err.message}`);
      console.log();
    }
  }

  if (!readline) rl.close();
  return { history };
}

async function createReadline() {
  const readline = await import('node:readline');
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    completer: (line) => completer(line),
  });
}

function completer(line) {
  const cmds = registryList();
  const hits = cmds.filter((c) => c.startsWith(line));
  return [hits.length ? hits : [], line];
}

async function executeLine(line, transport) {
  const [cmdPart, ...rest] = line.split(/\s+/);
  const cmd = cmdPart.startsWith('--') ? null : cmdPart;
  const args = cmd ? rest : [cmdPart, ...rest];

  if (!cmd) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'cmd', reason: 'no command specified' } });
  }

  const parsed = parseFlags(args, { cmd });
  return await runBuiltin(cmd, transport, parsed, { traceId: generateTraceId() });
}

function formatResult(result) {
  if (result && typeof result === 'object') {
    return JSON.stringify(result, null, 2);
  }
  return String(result);
}

function generateTraceId() {
  return `repl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
