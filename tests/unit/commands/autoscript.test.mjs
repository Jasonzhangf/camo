import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert';

function withCapturedConsole(run) {
  const originalLog = console.log;
  const originalError = console.error;
  const logs = [];
  const errors = [];
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  return Promise.resolve()
    .then(() => run({ logs, errors }))
    .finally(() => {
      console.log = originalLog;
      console.error = originalError;
    });
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseJsonLogs(lines) {
  return lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function createMinimalAutoscript({ profileId = 'p1' } = {}) {
  return {
    version: 1,
    name: 'unit-autoscript',
    profileId,
    throttle: 100,
    subscriptions: [],
    operations: [
      {
        id: 'bootstrap',
        action: 'wait',
        ms: 0,
        trigger: 'startup',
      },
    ],
  };
}

describe('autoscript command', () => {
  it('should export handleAutoscriptCommand', async () => {
    const mod = await import('../../../src/commands/autoscript.mjs');
    assert.strictEqual(typeof mod.handleAutoscriptCommand, 'function');
  });

  it('supports scaffold xhs-unified', async () => {
    const mod = await import('../../../src/commands/autoscript.mjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-autoscript-scaffold-'));
    const outputPath = path.join(tmpDir, 'xhs-autoscript.json');
    const logs = await withCapturedConsole(async ({ logs: captured }) => {
      await mod.handleAutoscriptCommand([
        'autoscript',
        'scaffold',
        'xhs-unified',
        '--output',
        outputPath,
        '--profile',
        'p1',
        '--keyword',
        '手机膜',
        '--do-likes',
      ]);
      return captured;
    });

    assert.ok(fs.existsSync(outputPath));
    const payload = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.strictEqual(payload.profileId, 'p1');
    assert.ok(payload.operations.some((op) => op.id === 'comment_like' && op.enabled === true));
    const commentsHarvest = payload.operations.find((op) => op.id === 'comments_harvest');
    assert.strictEqual(payload.metadata.persistComments, true);
    assert.strictEqual(commentsHarvest?.params?.includeComments, true);
    assert.ok(logs.some((line) => line.includes('"command": "autoscript.scaffold"')));
  });

  it('builds snapshot and replay summary from jsonl logs', async () => {
    const mod = await import('../../../src/commands/autoscript.mjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-autoscript-log-tools-'));
    const jsonlPath = path.join(tmpDir, 'run.jsonl');
    const snapshotPath = path.join(tmpDir, 'run.snapshot.json');
    const replaySummaryPath = path.join(tmpDir, 'run.replay.summary.json');
    const rows = [
      {
        runId: 'run-1',
        profileId: 'p1',
        event: 'autoscript:start',
        name: 'unit-autoscript',
        ts: '2026-02-01T00:00:00.000Z',
      },
      {
        runId: 'run-1',
        profileId: 'p1',
        event: 'autoscript:operation_done',
        operationId: 'bootstrap',
        result: { ok: true, code: 'OPERATION_DONE' },
        ts: '2026-02-01T00:00:01.000Z',
      },
      {
        runId: 'run-1',
        profileId: 'p1',
        event: 'autoscript:stop',
        reason: 'manual_stop',
        ts: '2026-02-01T00:00:02.000Z',
      },
    ];
    fs.writeFileSync(jsonlPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');

    await withCapturedConsole(async () => {
      await mod.handleAutoscriptCommand([
        'autoscript',
        'snapshot',
        jsonlPath,
        '--out',
        snapshotPath,
      ]);
    });
    assert.ok(fs.existsSync(snapshotPath));
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.strictEqual(snapshot.kind, 'autoscript_snapshot');
    assert.strictEqual(snapshot.runId, 'run-1');
    assert.strictEqual(snapshot.profileId, 'p1');
    assert.strictEqual(snapshot.summary.stopReason, 'manual_stop');
    assert.strictEqual(snapshot.state.operationState.bootstrap.status, 'done');

    await withCapturedConsole(async () => {
      await mod.handleAutoscriptCommand([
        'autoscript',
        'replay',
        jsonlPath,
        '--summary-file',
        replaySummaryPath,
      ]);
    });
    assert.ok(fs.existsSync(replaySummaryPath));
    const replaySummary = JSON.parse(fs.readFileSync(replaySummaryPath, 'utf8'));
    assert.strictEqual(replaySummary.stopReason, 'manual_stop');
    assert.strictEqual(replaySummary.counts.operationDone, 1);
    assert.strictEqual(replaySummary.counts.operationError, 0);
  });

  it('runs mock-run with fixture events and writes summary/jsonl', async () => {
    const mod = await import('../../../src/commands/autoscript.mjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-autoscript-mock-run-'));
    const scriptPath = path.join(tmpDir, 'script.json');
    const fixturePath = path.join(tmpDir, 'fixture.json');
    const summaryPath = path.join(tmpDir, 'summary.json');
    const jsonlPath = path.join(tmpDir, 'run.jsonl');

    writeJsonFile(scriptPath, createMinimalAutoscript({ profileId: 'p1' }));
    writeJsonFile(fixturePath, {
      profileId: 'fixture-profile',
      events: [],
      stopWhenMockEventsExhausted: true,
      operations: {
        bootstrap: {
          ok: true,
          code: 'OPERATION_DONE',
          message: 'mock done',
          data: { fromFixture: true },
        },
      },
    });

    const logs = await withCapturedConsole(async ({ logs: capturedLogs }) => {
      await mod.handleAutoscriptCommand([
        'autoscript',
        'mock-run',
        scriptPath,
        '--fixture',
        fixturePath,
        '--summary-file',
        summaryPath,
        '--jsonl-file',
        jsonlPath,
      ]);
      return capturedLogs;
    });

    assert.ok(fs.existsSync(summaryPath));
    assert.ok(fs.existsSync(jsonlPath));
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    assert.strictEqual(summary.stopReason, 'mock_events_exhausted');
    assert.strictEqual(summary.profileId, 'fixture-profile');
    assert.strictEqual(summary.counts.operationDone, 1);

    const parsedLogs = parseJsonLogs(logs);
    assert.ok(parsedLogs.some((row) => row.event === 'autoscript:operation_done' && row.operationId === 'bootstrap'));
    assert.ok(logs.some((line) => line.includes('"event": "autoscript:run_summary"')));
  });

  it('validates resume from-node before runtime start', async () => {
    const mod = await import('../../../src/commands/autoscript.mjs');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-autoscript-resume-'));
    const scriptPath = path.join(tmpDir, 'script.json');
    const snapshotPath = path.join(tmpDir, 'snapshot.json');

    writeJsonFile(scriptPath, createMinimalAutoscript({ profileId: 'p1' }));
    writeJsonFile(snapshotPath, {
      kind: 'autoscript_snapshot',
      version: 1,
      profileId: 'p1',
      state: {
        operationState: {
          bootstrap: {
            status: 'done',
            runs: 1,
            lastError: null,
            updatedAt: null,
            result: { code: 'OPERATION_DONE' },
          },
        },
      },
    });

    await assert.rejects(
      () => mod.handleAutoscriptCommand([
        'autoscript',
        'resume',
        scriptPath,
        '--snapshot',
        snapshotPath,
        '--from-node',
        'missing-node',
      ]),
      /Unknown --from-node operation id: missing-node/,
    );
  });
});
