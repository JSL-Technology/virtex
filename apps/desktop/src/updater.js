// Automatic updates: check, verify, download, and install — in that order, and only that order.
//
// ## The sequence, and what each step refuses
//
//  1. electron-updater fetches the channel manifest (`latest.yml`, `latest-mac.yml`, …) from the
//     configured HTTPS feed and decides whether a newer version exists. `allowDowngrade` is off.
//  2. Before a byte of the installer is downloaded, the shell fetches the release statement next to
//     the manifest and verifies it (release-verification.js): an Ed25519 signature from a key this
//     build trusts, for this product, channel, platform and architecture, naming exactly the version
//     and the SHA-512 of every file the manifest offers, strictly newer than what is installed, and
//     not expired. Anything else and the update is refused and logged — the shell keeps running the
//     version it has.
//  3. electron-updater downloads and checks the file's SHA-512 against the (now verified) manifest.
//  4. The platform verifies its own signature at install: Squirrel.Mac requires the update to satisfy
//     the running app's designated requirement; on Windows electron-updater checks the Authenticode
//     publisher. This module refuses to run updates on a Windows build whose `app-update.yml` names no
//     publisher, because electron-updater silently skips that check when the name is absent.
//  5. The person decides when to restart. The shell is also a point-of-sale terminal: restarting it
//     in the middle of a sale is not something an updater is entitled to do. An update the person
//     postpones installs when the application quits.
//
// ## Mandatory updates
//
// A release statement may declare a `minimumSupportedVersion`. A build below it has a defect serious
// enough that we no longer want it running (a security fix, a fiscal-calculation fix). The person is
// told, cannot dismiss the prompt for good, and is asked again every few minutes until they restart.
//
// ## Managed fleets
//
// An organisation that deploys through its own tooling (Intune, SCCM, Jamf) can turn the updater off
// with VIRTEX_DESKTOP_UPDATES=disabled. The choice is logged and shown in Help → Check for updates, so
// a machine that stops updating is never a mystery.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verifyRelease, statementFileName, ReleaseVerificationError } = require('./release-verification');

const STATEMENT_TIMEOUT_MS = 30_000;
const MANDATORY_REMINDER_MS = 10 * 60_000;
const FIRST_CHECK_MIN_MS = 60_000;
const FIRST_CHECK_JITTER_MS = 120_000;
const RESUME_DELAY_MS = 30_000;

/** Whether an administrator has turned automatic updates off for this machine. */
function disabledByPolicy(env) {
  return String(env.VIRTEX_DESKTOP_UPDATES ?? '').toLowerCase() === 'disabled';
}

/** electron-updater skips Authenticode verification when app-update.yml has no publisherName. */
function windowsPublisherConfigured(resourcesPath, readFile = fs.readFileSync) {
  try {
    const text = readFile(path.join(resourcesPath, 'app-update.yml'), 'utf8');
    return /^publisherName:\s*\S/m.test(text) || /^publisherName:\s*\n\s+-\s*\S/m.test(text);
  } catch {
    return false;
  }
}

/**
 * @param {object} deps
 * @param {import('electron').App} deps.app
 * @param {import('electron-updater').AppUpdater} deps.autoUpdater
 * @param {(url: string, init?: object) => Promise<Response>} deps.fetch   electron `net.fetch`
 * @param {import('electron').Dialog} deps.dialog
 * @param {import('electron').PowerMonitor} [deps.powerMonitor]
 * @param {ReturnType<import('./app-config').validateAppConfig>} deps.config
 * @param {ReturnType<import('./logger').createLogger>} deps.logger
 * @param {(key: string, params?: Record<string, string>) => string} deps.t
 * @param {() => import('electron').BrowserWindow | null} deps.getWindow
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {NodeJS.Platform} [deps.platform]
 * @param {string} [deps.arch]
 * @param {string} [deps.resourcesPath]
 * @param {typeof setTimeout} [deps.setTimer]
 */
function createUpdateController(deps) {
  const {
    app,
    fetch,
    dialog,
    powerMonitor,
    config,
    logger,
    t,
    getWindow,
    env = process.env,
    platform = process.platform,
    arch = process.arch,
    resourcesPath = process.resourcesPath,
    setTimer = setTimeout,
  } = deps;
  // Read lazily: requiring electron-updater is only meaningful (and only done) when updates run.
  const updater = () => deps.autoUpdater;

  const state = {
    status: 'idle', // idle | checking | downloading | ready | disabled
    disabledReason: null,
    pending: null, // { version, mandatory }
    manualCheck: false,
    timers: [],
  };

  function disable(reason, level = 'info') {
    state.status = 'disabled';
    state.disabledReason = reason;
    logger[level]('updates_disabled', { reason });
  }

  if (!app.isPackaged) disable('development_build');
  else if (!config.updates.enabled) disable('disabled_in_build');
  else if (disabledByPolicy(env)) disable('disabled_by_policy', 'warn');
  else if (platform === 'win32' && !windowsPublisherConfigured(resourcesPath)) {
    // Fail closed: without a publisher name electron-updater would install an unsigned file.
    disable('windows_publisher_missing', 'error');
  }

  function parent() {
    const win = getWindow();
    return win && !win.isDestroyed() ? win : undefined;
  }

  function message(options) {
    const owner = parent();
    return owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options);
  }

  async function fetchStatement() {
    const url = new URL(statementFileName(config.updates.channel, platform, arch), config.updates.feedUrl);
    const response = await fetch(url.toString(), {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(STATEMENT_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ReleaseVerificationError('STATEMENT_UNAVAILABLE', `Release statement returned HTTP ${response.status}`);
    }
    return response.text();
  }

  async function onUpdateAvailable(info) {
    let verdict;
    try {
      verdict = verifyRelease({
        envelopeText: await fetchStatement(),
        trustedKeys: config.updates.trustedKeys,
        updateInfo: info,
        currentVersion: app.getVersion(),
        channel: config.updates.channel,
        platform,
        arch,
      });
    } catch (error) {
      state.status = 'idle';
      logger.error('update_rejected', {
        offered: info?.version,
        code: error.code ?? 'VERIFICATION_ERROR',
        reason: error,
      });
      if (state.manualCheck) {
        state.manualCheck = false;
        await message({ type: 'error', message: t('desktop.update.verification_failed') });
      }
      return;
    }

    state.pending = { version: verdict.version, mandatory: verdict.mandatory };
    state.status = 'downloading';
    logger.info('update_verified', {
      version: verdict.version,
      mandatory: verdict.mandatory,
      minimumSupportedVersion: verdict.minimumSupportedVersion,
    });
    try {
      await updater().downloadUpdate();
    } catch (error) {
      state.status = 'idle';
      logger.error('update_download_failed', { version: verdict.version, reason: error });
    }
  }

  async function promptRestart(version) {
    const mandatory = Boolean(state.pending?.mandatory);
    const buttons = mandatory
      ? [t('desktop.update.restart_now'), t('desktop.update.remind_me')]
      : [t('desktop.update.restart_now'), t('desktop.update.later')];
    const { response } = await message({
      type: mandatory ? 'warning' : 'info',
      buttons,
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      title: t('desktop.update.ready_title'),
      message: t(mandatory ? 'desktop.update.mandatory_message' : 'desktop.update.ready_message', { version }),
      detail: t('desktop.update.restart_detail'),
    });
    if (response === 0) {
      logger.info('update_install_requested', { version, mandatory });
      // isSilent=false so the installer can show progress; isForceRunAfter=true to reopen the app.
      updater().quitAndInstall(false, true);
      return;
    }
    logger.info('update_postponed', { version, mandatory });
    if (mandatory) state.timers.push(setTimer(() => promptRestart(version), MANDATORY_REMINDER_MS));
  }

  function onUpdateDownloaded(event) {
    if (!state.pending || event?.version !== state.pending.version) {
      // A download we did not verify (it should be impossible: autoDownload is off). Never install it.
      logger.error('update_unverified_download_ignored', { version: event?.version });
      updater().autoInstallOnAppQuit = false;
      state.status = 'idle';
      return;
    }
    state.status = 'ready';
    state.manualCheck = false;
    logger.info('update_downloaded', { version: event.version });
    promptRestart(event.version).catch((error) => logger.error('update_prompt_failed', { reason: error }));
  }

  async function onNotAvailable() {
    state.status = 'idle';
    if (state.manualCheck) {
      state.manualCheck = false;
      await message({ type: 'info', message: t('desktop.update.up_to_date', { version: app.getVersion() }) });
    }
  }

  async function onError(error) {
    state.status = state.status === 'ready' ? 'ready' : 'idle';
    logger.error('update_error', { reason: error });
    if (state.manualCheck) {
      state.manualCheck = false;
      await message({ type: 'error', message: t('desktop.update.check_failed') });
    }
  }

  async function check({ manual = false } = {}) {
    if (state.status === 'disabled') {
      if (manual) {
        await message({
          type: 'info',
          message: t(
            state.disabledReason === 'disabled_by_policy'
              ? 'desktop.update.managed_by_organization'
              : 'desktop.update.unavailable_in_this_build',
          ),
        });
      }
      return;
    }
    if (state.status === 'ready') {
      if (manual) await promptRestart(state.pending.version);
      return;
    }
    if (state.status !== 'idle') return;
    state.status = 'checking';
    state.manualCheck = manual;
    try {
      await updater().checkForUpdates();
    } catch (error) {
      await onError(error);
    }
  }

  function start() {
    if (state.status === 'disabled') return;

    updater().logger = logger.updaterAdapter;
    updater().autoDownload = false; // nothing is downloaded before its statement verifies
    updater().autoInstallOnAppQuit = true;
    updater().allowDowngrade = false;
    updater().allowPrerelease = config.updates.channel !== 'latest';
    updater().fullChangelog = false;
    updater().setFeedURL({ provider: 'generic', url: config.updates.feedUrl, channel: config.updates.channel });

    updater().on('update-available', (info) => {
      onUpdateAvailable(info).catch((error) => logger.error('update_available_handler_failed', { reason: error }));
    });
    updater().on('update-not-available', () => {
      onNotAvailable().catch(() => undefined);
    });
    updater().on('update-downloaded', onUpdateDownloaded);
    updater().on('error', (error) => {
      onError(error).catch(() => undefined);
    });

    const interval = config.updates.checkIntervalMinutes * 60_000;
    const first = FIRST_CHECK_MIN_MS + Math.floor(Math.random() * FIRST_CHECK_JITTER_MS);
    state.timers.push(setTimer(() => check(), first));
    const periodic = setInterval(() => check(), interval);
    periodic.unref?.(); // the schedule must never be what keeps a quitting process alive
    state.timers.push(periodic);
    // A laptop that slept through the scheduled checks looks again shortly after waking.
    powerMonitor?.on('resume', () => state.timers.push(setTimer(() => check(), RESUME_DELAY_MS)));

    logger.info('updates_enabled', {
      feed: config.updates.feedUrl,
      channel: config.updates.channel,
      intervalMinutes: config.updates.checkIntervalMinutes,
      version: app.getVersion(),
    });
  }

  return {
    start,
    check,
    /** @internal for tests */
    state,
    /** @internal for tests */
    handlers: { onUpdateAvailable, onUpdateDownloaded, onNotAvailable, onError },
  };
}

module.exports = { createUpdateController, disabledByPolicy, windowsPublisherConfigured };
