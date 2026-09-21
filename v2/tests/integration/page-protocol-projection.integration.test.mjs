import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function runScript(source) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-protocol-input-home-'));
  try {
    const out = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: ROOT,
      env: { ...process.env, HOME: home },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(out.status, 0, `subprocess failed: ${out.stderr}`);
    return JSON.parse(out.stdout);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('positive: wait/readable command projections preserve operation fields', () => {
  const result = runScript(`
    import { __enableTestRoot as enablePipeline } from './v2/services/page_runtime/input_pipeline.mjs';
    import { __setBrowserForTest, __enableTestRoot as enableBridge } from './v2/services/browser_service/internal/camoufox_bridge.mjs';
    import { handleCommand } from './v2/shell/daemon/command_handlers.mjs';
    import * as session from './v2/services/session/manager.mjs';
    enablePipeline();
    enableBridge();
    session.__enableTestRoot();
    const calls = [];
    const original = globalThis.__camoTestImportOp;
    globalThis.__camoTestImportOp = null;
    const page = {
      waitForLoadState: async () => {},
      getByText: () => ({ waitFor: async () => {} }),
      locator: () => ({ waitFor: async () => {} }),
      evaluate: async () => 'readable body',
    };
    __setBrowserForTest('protocol_projection', { page });
    const ctx = { profile: 'protocol_projection', opts: { mode: 'persistent', daemonId: 'test' }, ensureBrowser: async () => {}, operationLoader: async (name) => {
      const ops = await import('./v2/services/page_runtime/input_pipeline.mjs');
      return ops[name];
    } };
    const record = session.create('protocol_projection', { instanceId: 'inst_projection', generation: 1 });
    const target = session.allocateTarget(record.profileId, page);
    const waitResult = await handleCommand('wait', { for: 'text', target: target.targetId, condition: 'Ready', timeout: 20 }, ctx);
    const readableResult = await handleCommand('get-readable', {}, ctx);
    calls.push(waitResult, readableResult);
    globalThis.__camoTestImportOp = original;
    process.stdout.write(JSON.stringify({ calls }));
  `);
  assert.equal(result.calls[0].ok, true);
  assert.equal(result.calls[0].waited, true);
  assert.equal(result.calls[1].ok, true);
  assert.equal(typeof result.calls[1].text, 'string');
});
