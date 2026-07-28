// camo v2 process entry. Module id=shell.bin_entry.
//
// `bin/camo` (top-level) is a thin shell script that runs this file
// with node. argv flows through argv-parser -> registry -> builtins ->
// transport -> result. Errors are surfaced via CamoError -> stderr.
//
// Hard guards:
//   - Single argv entrypoint.
//   - No side effects on import.
//   - All IO dispatches via the builtins + transports stack.

import { dispatch, usage } from '../cli/dispatch.mjs';
import { isCamoError, toWire } from '../../contracts/error_envelope/projector.mjs';

function printHelp() {
  process.stdout.write(usage() + '\n');
}

async function main(argv) {
  // argv[0]/[1] are node + script path; user args start at index 2.
  const args = argv.slice(2);
  try {
    const out = await dispatch(args);
    if (out.kind === 'help') {
      process.stdout.write((out.usage || usage()) + '\n');
      return 0;
    }
    if (out.kind === 'doctor') {
      process.stdout.write(JSON.stringify(out.report, null, 2) + '\n');
      return 0;
    }
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return 0;
  } catch (cause) {
    if (isCamoError(cause)) {
      const wire = toWire(cause);
      process.stderr.write(`camo: [${wire.code}] ${wire.message}\n`);
      if (wire.details) process.stderr.write(`  details: ${JSON.stringify(wire.details)}\n`);
      return 2;
    }
    process.stderr.write(`camo: internal error: ${cause?.message || String(cause)}\n`);
    return 3;
  }
}

const exitCode = await main(process.argv).catch((e) => {
  process.stderr.write(`camo: fatal: ${e?.message || String(e)}\n`);
  process.exit(3);
});
process.exit(exitCode);
