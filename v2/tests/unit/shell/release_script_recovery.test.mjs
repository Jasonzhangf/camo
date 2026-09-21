import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stdout || ''}${result.stderr || ''}`,
  );
  return result;
}

function setupRepo({ tagAtHead = true } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-release-recovery-'));
  const remote = path.join(tmpRoot, 'origin.git');
  const repo = path.join(tmpRoot, 'repo');
  const fakeBin = path.join(tmpRoot, 'bin');
  const ghCalls = path.join(tmpRoot, 'gh-calls.log');
  fs.mkdirSync(fakeBin, { recursive: true });

  run('git', ['init', '--bare', remote]);
  run('git', ['init', '-b', 'main', repo]);
  run('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  run('git', ['config', 'user.name', 'Camo Test'], { cwd: repo });
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'release.sh'),
    path.join(repo, 'scripts', 'release.sh'),
  );
  fs.copyFileSync(
    path.join(repoRoot, 'scripts', 'bump-version.mjs'),
    path.join(repo, 'scripts', 'bump-version.mjs'),
  );
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    `${JSON.stringify({
      name: 'camo-release-test',
      version: '0.4.7',
      scripts: { 'version:bump': 'node scripts/bump-version.mjs' },
    }, null, 2)}\n`,
    'utf8',
  );
  run('git', ['add', '.'], { cwd: repo });
  run('git', ['commit', '-m', 'test release recovery'], { cwd: repo });
  run('git', ['remote', 'add', 'origin', remote], { cwd: repo });
  run('git', ['push', '-u', 'origin', 'main'], { cwd: repo });
  run('git', ['tag', 'v0.4.7'], { cwd: repo });
  run('git', ['push', 'origin', 'v0.4.7'], { cwd: repo });
  if (!tagAtHead) {
    fs.writeFileSync(path.join(repo, 'after-tag.txt'), 'post-tag commit\n', 'utf8');
    run('git', ['add', 'after-tag.txt'], { cwd: repo });
    run('git', ['commit', '-m', 'advance main after tag'], { cwd: repo });
    run('git', ['push', 'origin', 'main'], { cwd: repo });
  }

  return { tmpRoot, repo, fakeBin, ghCalls };
}

function writeFakeGh(fakeBin, releaseExists) {
  const fakeGh = path.join(fakeBin, 'gh');
  fs.writeFileSync(fakeGh, `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_CALLS"
case "$1 $2" in
  "auth status"|"repo view") exit 0 ;;
  "release create")
    touch "$GH_RELEASE_MARKER"
    exit 0
    ;;
  "release view")
    if ${releaseExists ? 'true' : 'test -f "$GH_RELEASE_MARKER"'}; then
      exit 0
    fi
    exit 1
    ;;
esac
exit 1
`, { mode: 0o755 });
}

test('release recovery uses the existing tag without a second version bump', {
  skip: process.platform === 'win32',
}, () => {
  const { tmpRoot, repo, fakeBin, ghCalls } = setupRepo({ tagAtHead: false });
  try {
    writeFakeGh(fakeBin, false);
    const packageBefore = fs.readFileSync(path.join(repo, 'package.json'), 'utf8');
    const result = run('bash', ['scripts/release.sh', 'patch'], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH || ''}`,
        GH_CALLS: ghCalls,
        GH_RELEASE_MARKER: path.join(fakeBin, 'release-exists'),
      },
    });
    const packageAfter = fs.readFileSync(path.join(repo, 'package.json'), 'utf8');
    const tags = run('git', ['tag', '--list'], { cwd: repo }).stdout.trim().split('\n');
    const commits = run('git', ['rev-list', '--count', 'HEAD'], { cwd: repo }).stdout.trim();
    const calls = fs.readFileSync(ghCalls, 'utf8');

    assert.match(result.stdout, /Recovering missing GitHub Release for existing local tag v0\.4\.7/);
    assert.equal(packageAfter, packageBefore);
    assert.deepEqual(tags, ['v0.4.7']);
    assert.equal(commits, '2');
    assert.equal(fs.existsSync(path.join(fakeBin, 'release-exists')), true);
    assert.match(calls, /release create v0\.4\.7 --verify-tag --title v0\.4\.7 --notes Release v0\.4\.7/);
    assert.match(calls, /release view v0\.4\.7 --json tagName/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('completed release does not block the next version bump', {
  skip: process.platform === 'win32',
}, () => {
  const { tmpRoot, repo, fakeBin, ghCalls } = setupRepo();
  try {
    writeFakeGh(fakeBin, true);
    const result = spawnSync('bash', ['scripts/release.sh', 'patch'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH || ''}`,
        GH_CALLS: ghCalls,
        GH_RELEASE_MARKER: path.join(fakeBin, 'release-exists'),
      },
    });
    const calls = fs.existsSync(ghCalls) ? fs.readFileSync(ghCalls, 'utf8') : '';
    const packageJson = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));

    assert.notEqual(result.status, 0, 'normal release path should stop at the missing npm test fixture');
    assert.match(result.stderr, /npm.*test|Missing script: "test"|Missing script: "version:bump"/);
    assert.equal(packageJson.version, '0.4.8');
    assert.match(calls, /release view v0\.4\.7 --json tagName/);
    assert.doesNotMatch(calls, /release create v0\.4\.7/);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
