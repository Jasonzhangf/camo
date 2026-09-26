// camo v2 builtin: `camo autoscript run`.
// Parses CLI-only JSON and forwards the graph request to the daemon runner.

import path from 'node:path';
import { CamoError } from '../../contracts/error_envelope/projector.mjs';
import { sendCommand } from '../../transports/client/api.mjs';

export const cmd = 'autoscript';

export async function run(transport, parsed = {}) {
  const subcommand = parsed.positional?.[0];
  if (subcommand !== 'run') {
    throw new CamoError({
      code: 'E_INPUT_OUT_OF_RANGE',
      details: { field: 'subcommand', value: subcommand, allowed: ['run'] },
    });
  }
  if (!transport || typeof transport.sendFrame !== 'function') {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'transport' } });
  }

  const named = parsed.named || {};
  let action;
  try {
    action = JSON.parse(named.actionJson);
  } catch (cause) {
    throw new CamoError({
      code: 'E_INPUT_INVALID',
      details: { field: 'action-json', reason: 'must contain valid JSON', error: cause.message },
      cause,
    });
  }
  if (action === null || typeof action !== 'object' || Array.isArray(action)) {
    throw new CamoError({ code: 'E_INPUT_INVALID', details: { field: 'action-json', reason: 'must be a JSON object' } });
  }

  const reply = await sendCommand(transport, {
    cmd: 'autoscript',
    args: {
      subcommand,
      graphPath: path.resolve(named.graph),
      runId: named.runId,
      profile: parsed.profile || named.profile || process.env.CAMO_PROFILE || 'default',
      target: named.target,
      action,
    },
  });
  return reply.payload;
}
