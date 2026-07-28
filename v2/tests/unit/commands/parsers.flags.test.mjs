import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parse, infer } from '../../../commands/parsers/flags.mjs';

test('positive: start with --profile and --headless parses cleanly', () => {
  const r = parse(['--profile', 'p1', '--headless'], { cmd: 'start' });
  assert.equal(r.cmd, 'start');
  assert.equal(r.errors.length, 0);
  assert.equal(r.named.profile, 'p1');
  assert.equal(r.named.headless, true);
  assert.equal(r.profile, 'p1');
});

test('positive: goto parses positional url', () => {
  const r = parse(['https://example.com'], { cmd: 'goto' });
  assert.equal(r.cmd, 'goto');
  assert.equal(r.positional[0], 'https://example.com');
  assert.equal(r.errors.length, 0);
  assert.equal(r.missing_required.length, 0);
});

test('positive: default profile falls back to $CAMO_PROFILE || default', () => {
  process.env.CAMO_PROFILE = 'envprof';
  const r = parse(['--headless'], { cmd: 'start' });
  assert.equal(r.profile, 'envprof');
  delete process.env.CAMO_PROFILE;
});

test('negative: click without selector|text produces no errors at parser level', () => {
  // The parser treats both as optional; the caller (built-ins/click.mjs)
  // enforces "exactly one". Documented invariant.
  const r = parse([], { cmd: 'click' });
  assert.equal(r.errors.length, 0);
  assert.equal(r.named.selector, null);
  assert.equal(r.named.text, null);
});

test('negative: goto without url surfaces missing_required', () => {
  const r = parse([], { cmd: 'goto' });
  assert.equal(r.missing_required.length, 1);
  assert.equal(r.missing_required[0].name, 'url');
});

test('negative: goto with non-http url produces error', () => {
  const r = parse(['file:///tmp/x'], { cmd: 'goto' });
  assert.ok(r.errors.length >= 1);
  assert.equal(r.errors[0].field, 'positional[0]');
});

test('negative: type without text surfaces missing_required', () => {
  const r = parse([], { cmd: 'type' });
  assert.equal(r.missing_required.length, 1);
  assert.equal(r.missing_required[0].name, 'text');
});

test('negative: type --delay out of range produces error', () => {
  const r = parse(['hello', '--delay', '99999'], { cmd: 'type' });
  assert.ok(r.errors.length >= 1);
  assert.equal(r.errors[0].field, 'delay');
});

test('negative: unknown cmd in parser surfaces E_PROTO_NO_HANDLER in errors', () => {
  const r = parse(['--x'], { cmd: 'totally-unknown' });
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].field, 'cmd');
  assert.equal(r.errors[0].message, 'E_PROTO_NO_HANDLER');
});

test('utility: --help flag toggles help=true', () => {
  const r = parse(['--help'], { cmd: 'start' });
  assert.equal(r.help, true);
});

test('utility: --key=value format is supported', () => {
  const r = parse(['--profile=foo'], { cmd: 'start' });
  assert.equal(r.named.profile, 'foo');
  assert.equal(r.profile, 'foo');
});

test('utility: infer returns cmd token or null', () => {
  assert.equal(infer(['start', '--x'], null), 'start');
  assert.equal(infer(['--x'], null), null);
  assert.equal(infer([], null), null);
  assert.equal(infer(['not-a-cmd'], null), null);
});
