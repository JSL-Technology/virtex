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

// A self-signed P-256 certificate generated for this test only (no private key is kept anywhere),
// and the base64 SHA-256 of its SubjectPublicKeyInfo as `openssl x509 -pubkey | openssl pkey -pubin
// -outform der | openssl dgst -sha256 -binary | base64` prints it. The independent computation is
// the point: it proves spkiSha256 hashes the same bytes every pinning tool does.
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBmzCCAUGgAwIBAgIUIPbbhTyeY2KHi/R0O2gHUeDG6gowCgYIKoZIzj0EAwIw
IjEgMB4GA1UEAwwXcGluLXRlc3QudmlydGV4LmludmFsaWQwIBcNMjYxMTA4MDEx
NDMwWhgPMjEyNjEwMTUwMTE0MzBaMCIxIDAeBgNVBAMMF3Bpbi10ZXN0LnZpcnRl
eC5pbnZhbGlkMFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEIKIuoMgAgSd1Xg+e
w3Ol1zymPMkA9enJDKlp4V3s8rVkIYH4pmp48VQgpcCjwzqy9kfRNJHqVKLg7zmc
wTl7vqNTMFEwHQYDVR0OBBYEFHiMQzy6bikK7RPiwt1gXfqBWnZUMB8GA1UdIwQY
MBaAFHiMQzy6bikK7RPiwt1gXfqBWnZUMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZI
zj0EAwIDSAAwRQIgJjIwQbU1Aaf9Uxu48Sv+spjWwnn9rZWOAD6Xxi+783sCIQDT
tXC0VVufHucJh1qqxklbCXai7647k1G6ZwXaUq7UEQ==
-----END CERTIFICATE-----`;
const TEST_PIN = 'Ge2baYxUMsrA5rkW9gOXxSzJudcNthaxyM4TR/UcTNU=';
const OTHER_PIN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

test('the SPKI hash matches what openssl computes', () => {
  assert.equal(policy.spkiSha256(TEST_CERT), TEST_PIN);
});

test('pinning: no pins accepts, a pinned key in the chain accepts, anything else rejects', () => {
  assert.equal(policy.chainMatchesPins([TEST_CERT], []), true);
  assert.equal(policy.chainMatchesPins([TEST_CERT], [OTHER_PIN, TEST_PIN]), true);
  assert.equal(policy.chainMatchesPins([TEST_CERT], [OTHER_PIN]), false);
  // An unparseable chain fails closed instead of throwing past the verifier.
  assert.equal(policy.chainMatchesPins(['not a certificate'], [TEST_PIN]), false);
});

test('pins apply only to the configured hosts', () => {
  assert.deepEqual([...policy.pinnedHosts(ORIGINS)], ['app.virtex.io', 'pos.virtex.io']);
});

test('the baseline CSP is added beside the server policy, never replacing it', () => {
  const server = "default-src 'self'; script-src 'self'";
  const headers = policy.withBaselineCsp({ 'content-security-policy': [server], 'x-frame-options': ['DENY'] });
  assert.deepEqual(headers['Content-Security-Policy'], [server, policy.BASELINE_CSP]);
  assert.equal(headers['content-security-policy'], undefined);
  assert.deepEqual(headers['x-frame-options'], ['DENY']);
  // A response with no policy at all still gets the baseline.
  assert.deepEqual(policy.withBaselineCsp({})['Content-Security-Policy'], [policy.BASELINE_CSP]);
  for (const directive of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'"]) {
    assert.ok(policy.BASELINE_CSP.includes(directive), directive);
  }
  // script-src is the server's decision; the shell must not half-apply one.
  assert.ok(!policy.BASELINE_CSP.includes('script-src'));
});
