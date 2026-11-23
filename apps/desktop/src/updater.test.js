'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const rv = require('./release-verification');
const { createUpdateController, disabledByPolicy, windowsPublisherConfigured } = require('./updater');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const SHA = crypto.createHash('sha512').update('installer').digest('base64');
const FILES = [{ url: 'Virtex-Desktop-1.4.0-x64.AppImage', sha512: SHA, size: 10 }];

function envelope(overrides = {}) {
  return JSON.stringify(
    rv.signStatement(
      {
        schema: 1,
        product: 'io.virtex.desktop',
        channel: 'latest',
        platform: 'linux',
        arch: 'x64',
        version: '1.4.0',
        expires: new Date(Date.now() + 86_400_000).toISOString(),
        files: FILES,
        ...overrides,
      },
      'k',
      privateKey,
    ),
  );
}

function harness({ statement = envelope(), status = 200, packaged = true, env = {}, platform = 'linux', updatesEnabled = true } = {}) {
  const updater = new EventEmitter();
  updater.calls = [];
  updater.setFeedURL = (options) => updater.calls.push(['setFeedURL', options]);
  updater.checkForUpdates = async () => updater.calls.push(['check']);
  updater.downloadUpdate = async () => updater.calls.push(['download']);
  updater.quitAndInstall = (...args) => updater.calls.push(['quitAndInstall', ...args]);

  const dialogs = [];
  const answers = [];
  const timers = [];
  const logs = [];
  const fetched = [];
  const controller = createUpdateController({
    app: { isPackaged: packaged, getVersion: () => '1.3.0' },
    autoUpdater: updater,
    fetch: async (url, init) => {
      fetched.push({ url, init });
      return { ok: status === 200, status, text: async () => statement };
    },
    dialog: {
      showMessageBox: async (options) => {
        dialogs.push(options);
        return { response: answers.shift() ?? 1 };
      },
    },
    config: {
      updates: {
        enabled: updatesEnabled,
        feedUrl: 'https://updates.virtex.io/desktop/',
        channel: 'latest',
        checkIntervalMinutes: 240,
        trustedKeys: rv.loadTrustedKeys({ k: publicKey.export({ type: 'spki', format: 'pem' }) }),
      },
    },
    logger: {
      info: (event, fields) => logs.push(['info', event, fields]),
      warn: (event, fields) => logs.push(['warn', event, fields]),
      error: (event, fields) => logs.push(['error', event, fields]),
      updaterAdapter: {},
    },
    t: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    getWindow: () => null,
    env,
    platform,
    arch: 'x64',
    resourcesPath: '/nowhere',
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return { unref: () => undefined };
    },
  });
  return { controller, updater, dialogs, answers, timers, logs, fetched };
}

test('a verified update is downloaded; nothing is downloaded before verification', async () => {
  const h = harness();
  h.controller.start();
  assert.equal(h.updater.autoDownload, false);
  assert.equal(h.updater.allowDowngrade, false);
  assert.deepEqual(h.updater.calls[0], ['setFeedURL', { provider: 'generic', url: 'https://updates.virtex.io/desktop/', channel: 'latest' }]);

  await h.controller.handlers.onUpdateAvailable({ version: '1.4.0', files: FILES });
  assert.equal(h.fetched[0].url, 'https://updates.virtex.io/desktop/latest-linux.release.dsse.json');
  assert.equal(h.fetched[0].init.redirect, 'error');
  assert.deepEqual(h.updater.calls.at(-1), ['download']);
  assert.equal(h.controller.state.status, 'downloading');
});

test('a manifest the statement does not vouch for is refused and never downloaded', async () => {
  const h = harness();
  h.controller.start();
  await h.controller.handlers.onUpdateAvailable({ version: '1.4.0', files: [{ ...FILES[0], sha512: crypto.createHash('sha512').update('evil').digest('base64') }] });
  assert.ok(!h.updater.calls.some(([call]) => call === 'download'));
  assert.deepEqual(h.logs.find(([, event]) => event === 'update_rejected')[2].code, 'FILE_HASH_MISMATCH');
});

test('a missing statement is a refusal, not a pass', async () => {
  const h = harness({ status: 404 });
  h.controller.start();
  await h.controller.handlers.onUpdateAvailable({ version: '1.4.0', files: FILES });
  assert.ok(!h.updater.calls.some(([call]) => call === 'download'));
  assert.equal(h.logs.find(([, event]) => event === 'update_rejected')[2].code, 'STATEMENT_UNAVAILABLE');
});

test('a download that was not verified is never installed', () => {
  const h = harness();
  h.controller.start();
  h.updater.autoInstallOnAppQuit = true;
  h.controller.handlers.onUpdateDownloaded({ version: '9.9.9' });
  assert.equal(h.updater.autoInstallOnAppQuit, false);
  assert.ok(!h.updater.calls.some(([call]) => call === 'quitAndInstall'));
});

test('the person decides when to restart; "later" installs on quit', async () => {
  const h = harness();
  h.controller.start();
  await h.controller.handlers.onUpdateAvailable({ version: '1.4.0', files: FILES });
  h.answers.push(1);
  h.controller.handlers.onUpdateDownloaded({ version: '1.4.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.dialogs.at(-1).buttons[1], 'desktop.update.later');
  assert.ok(!h.updater.calls.some(([call]) => call === 'quitAndInstall'));
  assert.equal(h.updater.autoInstallOnAppQuit, true);

  // Help → Check for updates offers the downloaded update again, and accepting it installs.
  h.answers.push(0);
  await h.controller.check({ manual: true });
  assert.deepEqual(h.updater.calls.at(-1), ['quitAndInstall', false, true]);
});

test('a mandatory update keeps asking until the person restarts', async () => {
  const h = harness({ statement: envelope({ minimumSupportedVersion: '1.3.5' }) });
  h.controller.start();
  await h.controller.handlers.onUpdateAvailable({ version: '1.4.0', files: FILES });
  h.answers.push(1);
  h.controller.handlers.onUpdateDownloaded({ version: '1.4.0' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(h.dialogs.at(-1).message, /mandatory_message/);
  const reminder = h.timers.at(-1);
  assert.equal(reminder.ms, 10 * 60_000);

  h.answers.push(0);
  await reminder.fn();
  assert.deepEqual(h.updater.calls.at(-1), ['quitAndInstall', false, true]);
});

test('updates are off in development, when the build says so, and by administrator policy', async () => {
  assert.equal(harness({ packaged: false }).controller.state.disabledReason, 'development_build');
  assert.equal(harness({ updatesEnabled: false }).controller.state.disabledReason, 'disabled_in_build');
  const managed = harness({ env: { VIRTEX_DESKTOP_UPDATES: 'disabled' } });
  assert.equal(managed.controller.state.disabledReason, 'disabled_by_policy');
  await managed.controller.check({ manual: true });
  assert.equal(managed.dialogs[0].message, 'desktop.update.managed_by_organization');
  assert.equal(disabledByPolicy({ VIRTEX_DESKTOP_UPDATES: 'DISABLED' }), true);
  assert.equal(disabledByPolicy({}), false);
});

test('on Windows, no publisher name in app-update.yml means no updates (fail closed)', () => {
  assert.equal(harness({ platform: 'win32' }).controller.state.disabledReason, 'windows_publisher_missing');
  assert.equal(windowsPublisherConfigured('/r', () => 'provider: generic\npublisherName:\n  - JSL Technology SRL\n'), true);
  assert.equal(windowsPublisherConfigured('/r', () => 'provider: generic\npublisherName: JSL Technology SRL\n'), true);
  assert.equal(windowsPublisherConfigured('/r', () => 'provider: generic\n'), false);
  assert.equal(windowsPublisherConfigured('/r', () => { throw new Error('ENOENT'); }), false);
});

test('a manual check reports "up to date" and failures; a scheduled one stays quiet', async () => {
  const h = harness();
  h.controller.start();
  await h.controller.check({ manual: true });
  await h.controller.handlers.onNotAvailable();
  assert.match(h.dialogs.at(-1).message, /up_to_date/);

  const quiet = harness();
  quiet.controller.start();
  await quiet.controller.check();
  await quiet.controller.handlers.onError(new Error('offline'));
  assert.equal(quiet.dialogs.length, 0);
  assert.ok(quiet.logs.some(([level, event]) => level === 'error' && event === 'update_error'));
});
