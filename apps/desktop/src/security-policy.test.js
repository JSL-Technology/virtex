'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./security-policy');

const ORIGINS = ['https://app.virtex.io', 'https://pos.virtex.io'];

test('only https and mailto links leave for the operating system', () => {
  assert.equal(policy.mayOpenExternally('https://docs.example.com/guide'), true);
  assert.equal(policy.mayOpenExternally('mailto:soporte@example.com'), true);
  for (const url of [
    'http://example.com',
    'file:///C:/Windows/System32/calc.exe',
    'smb://share/folder',
    'ms-msdt:/id',
    'javascript:alert(1)',
    'vscode://open',
    'not a url',
    'https://user:pass@example.com',
  ]) {
    assert.equal(policy.mayOpenExternally(url), false, url);
  }
});

test('a packaged build refuses missing or plain-http targets', () => {
  assert.throws(() => policy.resolveTargets({}, true), /DESKTOP_PORTAL_URL is missing/);
  assert.throws(
    () => policy.resolveTargets({ DESKTOP_PORTAL_URL: 'http://app.virtex.io', DESKTOP_POS_URL: 'https://pos.virtex.io' }, true),
    /must use https/,
  );
  const ok = policy.resolveTargets(
    { DESKTOP_PORTAL_URL: 'https://app.virtex.io', DESKTOP_POS_URL: 'https://pos.virtex.io/terminal' },
    true,
  );
  assert.deepEqual(ok.allowedOrigins, ORIGINS);
});

test('development falls back to the local servers', () => {
  const dev = policy.resolveTargets({}, false);
  assert.deepEqual(dev.allowedOrigins, ['http://localhost:4200', 'http://localhost:4300']);
  assert.throws(() => policy.resolveTargets({ DESKTOP_PORTAL_URL: 'file:///tmp/x.html' }, false), /http\(s\)/);
});

test('trust is by exact origin', () => {
  assert.equal(policy.isTrustedUrl('https://app.virtex.io/dashboard', ORIGINS), true);
  assert.equal(policy.isTrustedUrl('https://app.virtex.io.evil.example/', ORIGINS), false);
  assert.equal(policy.isTrustedUrl('http://app.virtex.io/', ORIGINS), false);
  assert.equal(policy.isTrustedUrl('data:text/html,hi', ORIGINS), false);
  assert.equal(policy.isTrustedSender('about:blank', ORIGINS), false);
});

test('only a short list of permissions, and only to trusted pages', () => {
  assert.equal(policy.mayGrantPermission('notifications', 'https://app.virtex.io/', ORIGINS), true);
  assert.equal(policy.mayGrantPermission('media', 'https://app.virtex.io/', ORIGINS), false);
  assert.equal(policy.mayGrantPermission('notifications', 'https://evil.example/', ORIGINS), false);
});
