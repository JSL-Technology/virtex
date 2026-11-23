'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger, redact, MAX_BYTES } = require('./logger');

test('query strings and fragments never reach the log', () => {
  assert.equal(redact('GET https://app.virtex.io/e/acme/invoices/42?token=secret#x failed'), 'GET https://app.virtex.io/e/acme/invoices/42 failed');
  assert.equal(redact(42), 42);
});

test('entries are JSON lines and the file rotates by size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vx-log-'));
  const logger = createLogger({ directory: dir });
  logger.info('started', { version: '1.0.0', reason: new Error('boom https://x.io/a?b=c') });
  const [line] = fs.readFileSync(logger.file, 'utf8').trim().split('\n');
  const entry = JSON.parse(line);
  assert.equal(entry.event, 'started');
  assert.equal(entry.reason, 'boom https://x.io/a');

  fs.writeFileSync(logger.file, 'x'.repeat(MAX_BYTES));
  logger.warn('after_rotation');
  assert.ok(fs.existsSync(`${logger.file}.1`));
  assert.match(fs.readFileSync(logger.file, 'utf8'), /after_rotation/);
  fs.rmSync(dir, { recursive: true, force: true });
});
