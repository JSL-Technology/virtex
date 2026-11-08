// electron-builder configuration for the Virtex desktop shell.
//
// ## Two modes, and why a release cannot quietly become the other
//
// `VIRTEX_DESKTOP_RELEASE=true` (set only by .github/workflows/desktop-release.yml) builds what
// customers install. In that mode this file REFUSES to produce anything unless every signing input is
// present: an unsigned installer is not a degraded release, it is a different product — Windows
// SmartScreen and macOS Gatekeeper warn on it, auto-update cannot verify it, and nothing proves it
// came from us. `forceCodeSigning` makes electron-builder fail rather than skip signing.
//
// Without the flag (a developer running `nx run desktop:package`) it builds unsigned local packages,
// with no publish configuration, so nothing a laptop produces can ever be served as an update.
//
// ## What every build carries
//
//   - Electron fuses: the binary itself refuses ELECTRON_RUN_AS_NODE, NODE_OPTIONS and --inspect
//     (each turns any signed Electron app into a signed Node.js interpreter an attacker can drive),
//     validates the asar against the hash embedded at build time, loads application code only from
//     that asar, encrypts cookies at rest, and gives file:// no extra privileges.
//   - asar packaging with only the application's own sources and its single runtime dependency
//     (electron-updater): `directories.app` points at apps/desktop, whose package.json is the app's
//     manifest, so none of the monorepo's server or Angular dependencies can end up in the bundle.
//   - macOS: hardened runtime with the minimum entitlements, notarisation with a stapled ticket.
//   - Windows: Authenticode with SHA-256 and an RFC 3161 timestamp through Azure Trusted Signing (keys
//     held in a FIPS 140-2 Level 3 HSM, which the CA/Browser Forum has required for code-signing keys
//     since June 2023); the publisher name is written to app-update.yml so the updater can check it.
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_DIR = __dirname;
const CONFIG_FILE = path.join(APP_DIR, 'config', 'app-config.json');

const release = process.env.VIRTEX_DESKTOP_RELEASE === 'true';

const { missingReleaseInputs } = require('./build/release-inputs.cjs');

function releaseConfig() {
  let appConfig;
  try {
    appConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    throw new Error(
      `Release build without ${path.relative(ROOT, CONFIG_FILE)}: run tools/desktop/write-app-config.mjs first (${error.message}).`,
    );
  }
  const missing = missingReleaseInputs(process.platform, process.env);
  if (missing.length) {
    throw new Error(`Release build refused: missing ${missing.join(', ')}. An unsigned release is never published.`);
  }
  if (appConfig.updates?.enabled === false) return { appConfig, publish: null };
  return {
    appConfig,
    publish: [{ provider: 'generic', url: appConfig.updates.feedUrl, channel: appConfig.updates.channel }],
  };
}

const { publish } = release ? releaseConfig() : { publish: null };

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'io.virtex.desktop',
  productName: 'Virtex Desktop',
  copyright: `Copyright © ${new Date().getUTCFullYear()} JSL Technology`,
  directories: {
    app: 'apps/desktop',
    buildResources: 'apps/desktop/build',
    output: 'dist/apps/desktop-package',
  },
  files: [
    'package.json',
    'src/**/*',
    '!src/**/*.test.js',
    'config/app-config.json',
    // The runtime dependency is resolved and pruned by electron-builder from apps/desktop/package.json.
  ],
  asar: true,
  // Nothing native is shipped; an empty unpack list keeps every byte under asar integrity.
  asarUnpack: [],
  compression: 'normal',
  forceCodeSigning: release,
  // Never publish from electron-builder itself: the release workflow publishes only after it has
  // verified signatures and signed the release statements (tools/desktop/sign-release-statements.mjs).
  publish,

  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    loadBrowserProcessSpecificV8Snapshot: false,
    grantFileProtocolExtraPrivileges: false,
  },

  mac: {
    category: 'public.app-category.business',
    // zip is what Squirrel.Mac installs from; dmg is what a person downloads.
    target: [
      { target: 'dmg', arch: ['arm64', 'x64'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'apps/desktop/build/entitlements.mac.plist',
    entitlementsInherit: 'apps/desktop/build/entitlements.mac.plist',
    notarize: release,
    minimumSystemVersion: '13.0', // Electron 44+ dropped macOS 12
  },
  dmg: {
    sign: release,
  },

  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    ...(release
      ? {
          azureSignOptions: {
            publisherName: process.env.WINDOWS_PUBLISHER_NAME,
            endpoint: process.env.AZURE_TRUSTED_SIGNING_ENDPOINT,
            codeSigningAccountName: process.env.AZURE_TRUSTED_SIGNING_ACCOUNT,
            certificateProfileName: process.env.AZURE_TRUSTED_SIGNING_PROFILE,
            // SHA-256 for the file digest and for the RFC 3161 timestamp; SHA-1 is never used.
            fileDigest: 'SHA256',
            timestampRfc3161: 'http://timestamp.acs.microsoft.com',
            timestampDigest: 'SHA256',
          },
        }
      : {}),
    requestedExecutionLevel: 'asInvoker',
    // The updater checks the downloaded installer's Authenticode publisher against this name.
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    // Updates download only the blocks that changed.
    differentialPackage: true,
    // A person's local data (session, cached catalogue) is theirs to keep across a reinstall.
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Virtex Desktop',
  },

  linux: {
    target: [
      { target: 'AppImage', arch: ['x64', 'arm64'] },
      { target: 'deb', arch: ['x64', 'arm64'] },
      { target: 'rpm', arch: ['x64'] },
    ],
    category: 'Office',
    maintainer: 'JSL Technology <desktop@virtex.io>',
    vendor: 'JSL Technology',
    synopsis: 'Virtex ERP desktop',
  },
};
