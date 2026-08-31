import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { run as runSetUserAgent } from '../../commands/builtins/setUserAgent.mjs';

function transportWith(payload) {
  return { sendFrame: async (request) => ({ id: request.id, kind: 'result', payload }) };
}

test('set-user-agent projects exact runtime success truth', async () => {
  const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)';
  const output = await runSetUserAgent(
    transportWith({ ok: true, set: true, userAgent: ua }),
    { profile: 'ua_wire', named: { ua } },
  );

  assert.equal(output.set, true);
  assert.equal(output.userAgent, ua);
});

test('set-user-agent rejects a success-shaped response without set truth', async () => {
  await assert.rejects(
    () => runSetUserAgent(
      transportWith({ ok: true, userAgentSet: true }),
      { profile: 'ua_wire', named: { ua: 'Mozilla/5.0' } },
    ),
    (cause) => cause?.code === 'E_PROTO_BAD_ENVELOPE',
  );
});

test('negative: set-user-agent has no Page.setUserAgent compatibility path', () => {
  const source = fs.readFileSync(new URL('../../services/page_runtime/operations/config_ops.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /page\.setUserAgent/);
});
