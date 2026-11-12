// What a release build must be given, per platform, before electron-builder may run.
//
// Kept apart from electron-builder.config.cjs so it can be tested for every platform from any
// machine: the configuration only ever sees the platform it runs on, and a gap in, say, the Windows
// list would otherwise surface only on a Windows runner — as an unsigned installer.
'use strict';

const REQUIRED = Object.freeze({
  all: ['VIRTEX_DESKTOP_RELEASE'],
  // Developer ID Application certificate and the App Store Connect API key notarytool uses.
  darwin: ['CSC_LINK', 'CSC_KEY_PASSWORD', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  // Azure Trusted Signing: the service principal, the account and certificate profile, and the
  // publisher name the updater will check the installer against.
  win32: [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_TRUSTED_SIGNING_ENDPOINT',
    'AZURE_TRUSTED_SIGNING_ACCOUNT',
    'AZURE_TRUSTED_SIGNING_PROFILE',
    'WINDOWS_PUBLISHER_NAME',
  ],
  // Linux packages carry no platform signature; their integrity rests on the release statement
  // (signed in the publish job) and the SLSA provenance attestation.
  linux: [],
});

/** Names that are required on `platform` and absent from `env`. */
function missingReleaseInputs(platform, env) {
  return [...REQUIRED.all, ...(REQUIRED[platform] ?? [])].filter((name) => !env[name]);
}

module.exports = { REQUIRED, missingReleaseInputs };
