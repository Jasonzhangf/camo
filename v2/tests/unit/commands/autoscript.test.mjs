import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../../../commands/builtins/autoscript.mjs';
import { parse } from '../../../commands/parsers/flags.mjs';

test('autoscript run parses required CLI arguments and forwards ARC request', async () => {
  const parsed = parse([
    'run', '--graph', 'v2/docs/dagpipe/camo-runtime.graph.json', '--run-id', 'run-1',
    '--profile', 'profile-1', '--target', 'target-1', '--action-json', '{"kind":"click","role":"button"}',
  ], { cmd: 'autoscript' });
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.missing_required, []);

  let sent;
  const transport = {
    async sendFrame(env) {
      sent = env;
      return { id: env.id, kind: 'result', payload: { ok: true, graphId: 'camo-runtime' } };
    },
  };
  const result = await run(transport, parsed);
  assert.deepEqual(result, { ok: true, graphId: 'camo-runtime' });
  assert.equal(sent.payload.cmd, 'autoscript');
  assert.equal(sent.payload.args.subcommand, 'run');
  assert.equal(sent.payload.args.runId, 'run-1');
  assert.equal(sent.payload.args.profile, 'profile-1');
  assert.equal(sent.payload.args.target, 'target-1');
  assert.deepEqual(sent.payload.args.action, { kind: 'click', role: 'button' });
  assert.match(sent.payload.args.graphPath, /v2\/docs\/dagpipe\/camo-runtime\.graph\.json$/);
});

test('autoscript parser requires graph, run id, profile, target, and action JSON', () => {
  const parsed = parse([], { cmd: 'autoscript' });
  assert.deepEqual(parsed.missing_required.map((field) => field.name), ['subcommand']);
  assert.deepEqual(parsed.errors.map((error) => error.field), ['graph', 'runId', 'profile', 'target', 'actionJson']);
});

test('autoscript rejects malformed or non-object action JSON before transport', async () => {
  let sent = false;
  const transport = { async sendFrame() { sent = true; } };
  await assert.rejects(
    run(transport, { positional: ['run'], profile: 'p', named: { graph: 'g.json', runId: 'r', target: 't', actionJson: '[' } }),
    (error) => error.code === 'E_INPUT_INVALID',
  );
  await assert.rejects(
    run(transport, { positional: ['run'], profile: 'p', named: { graph: 'g.json', runId: 'r', target: 't', actionJson: '[]' } }),
    (error) => error.code === 'E_INPUT_INVALID',
  );
  assert.equal(sent, false);
});
