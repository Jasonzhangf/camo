// camo v2 unit tests: shell modules (config, logging, tracer)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, getDefault, CONFIG_KEYS } from '../../../shell/config/loader.mjs';
import { createLogger, LOG_LEVELS } from '../../../shell/logging/logger.mjs';
import { createTracer } from '../../../shell/tracer/tracer.mjs';

test('config: loadConfig returns defaults when no overrides', () => {
  const config = loadConfig({});
  assert.ok(config.profile);
  assert.ok(config.logLevel);
  assert.ok(config.wsUrl);
  assert.ok(config.httpUrl);
  assert.equal(typeof config.timeout, 'number');
});

test('config: loadConfig applies overrides', () => {
  const config = loadConfig({ profile: 'test-profile', logLevel: 'debug' });
  assert.equal(config.profile, 'test-profile');
  assert.equal(config.logLevel, 'debug');
});

test('config: getDefault returns expected keys', () => {
  assert.ok(CONFIG_KEYS.includes('profile'));
  assert.ok(CONFIG_KEYS.includes('logLevel'));
  assert.ok(CONFIG_KEYS.includes('wsUrl'));
  assert.ok(CONFIG_KEYS.length > 5);
});

test('logging: createLogger with default level', () => {
  const logger = createLogger({});
  assert.equal(typeof logger.info, 'function');
  assert.equal(typeof logger.debug, 'function');
  assert.equal(typeof logger.error, 'function');
});

test('logging: logger respects log levels', () => {
  const logger = createLogger({ level: 'error' });
  // Should not throw, just filter
  logger.trace('should not appear');
  logger.debug('should not appear');
  logger.info('should not appear');
  logger.warn('should not appear');
});

test('logging: LOG_LEVELS includes expected levels', () => {
  assert.ok(LOG_LEVELS.includes('trace'));
  assert.ok(LOG_LEVELS.includes('debug'));
  assert.ok(LOG_LEVELS.includes('info'));
  assert.ok(LOG_LEVELS.includes('warn'));
  assert.ok(LOG_LEVELS.includes('error'));
  assert.ok(LOG_LEVELS.includes('fatal'));
});

test('tracer: createTracer returns interface', () => {
  const tracer = createTracer({});
  assert.equal(typeof tracer.startTrace, 'function');
  assert.equal(typeof tracer.endSpan, 'function');
  assert.equal(typeof tracer.addEvent, 'function');
  assert.equal(typeof tracer.getTrace, 'function');
});

test('tracer: startTrace creates a span', () => {
  const tracer = createTracer({});
  const span = tracer.startTrace('test-span');
  assert.ok(span.traceId);
  assert.ok(span.spanId);
  assert.equal(span.name, 'test-span');
  assert.equal(span.status, 'running');
});

test('tracer: endSpan completes a span', () => {
  const tracer = createTracer({});
  const span = tracer.startTrace('test-span');
  const completed = tracer.endSpan(span.spanId, 'ok');
  assert.equal(completed.status, 'ok');
  assert.ok(completed.duration >= 0);
});

test('tracer: addEvent adds to span', () => {
  const tracer = createTracer({});
  const span = tracer.startTrace('test-span');
  tracer.addEvent(span.spanId, 'test-event', { foo: 'bar' });
  const updated = tracer.getTrace(span.traceId)[0];
  assert.equal(updated.events.length, 1);
  assert.equal(updated.events[0].name, 'test-event');
  assert.equal(updated.events[0].data.foo, 'bar');
});

test('tracer: endSpan with error captures error', () => {
  const tracer = createTracer({});
  const span = tracer.startTrace('test-span');
  const err = new Error('test error');
  err.code = 'E_TEST';
  tracer.endSpan(span.spanId, 'error', err);
  const completed = tracer.getTrace(span.traceId)[0];
  assert.equal(completed.status, 'error');
  assert.ok(completed.error);
  assert.equal(completed.error.code, 'E_TEST');
});
