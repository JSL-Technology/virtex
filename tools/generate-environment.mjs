#!/usr/bin/env node
/**
 * Materialise the frontend's production environment from deployment variables.
 *
 * Angular bakes `environment.production.ts` into the bundle at build time, so the values it
 * carries have to be present on disk before the compiler runs. Committing real values is not an
 * option (they differ per environment and the API URL is deployment-specific), and committing
 * localhost defaults is how a build ends up shipping a client that talks to the developer's own
 * machine — the exact failure this script exists to make impossible.
 *
 * Run it immediately before `nx build client-web --configuration=production`. It fails loudly
 * when a required variable is missing rather than substituting a default, so a misconfigured
 * pipeline stops at the build instead of at a user's browser.
 *
 * Required:
 *   API_URL                  Absolute base URL of the API, including the version prefix.
 *                            e.g. https://api.example.com/api/v1
 *   RECAPTCHA_V3_SITE_KEY    reCAPTCHA v3 site key for this environment.
 *
 * Optional:
 *   VAPID_PUBLIC_KEY         Web-push public key. Push notifications are disabled when absent.
 *   GOOGLE_MAPS_API_KEY      Maps Embed API key. The session-location map is hidden when absent.
 *   POS_URL                  Where the point-of-sale application is served. Default `/pos/`: the
 *                            same origin as the ERP, which is what lets the two share a session.
 *   ERP_URL                  (POS only) Where the ERP is served, for the till's «back office»
 *                            link. Default `/`.
 *
 * `--app=pos` writes the point-of-sale application's environment instead of the ERP's
 * (apps/pos/src/environments/environment.production.ts). Same variables, same rules.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = (process.argv.find((arg) => arg.startsWith('--app=')) ?? '--app=client-web').slice('--app='.length);
const TARGETS = {
  'client-web': resolve(HERE, '../apps/core/client-web/src/environments/environment.production.ts'),
  pos: resolve(HERE, '../apps/pos/src/environments/environment.production.ts'),
};
const TARGET = TARGETS[APP];

/** Variables without a safe default. A missing one is a configuration error, not a fallback. */
const REQUIRED = ['API_URL', 'RECAPTCHA_V3_SITE_KEY'];

function fail(message) {
  console.error(`\n  generate-environment: ${message}\n`);
  process.exit(1);
}

if (!TARGET) fail(`unknown --app "${APP}" (expected one of: ${Object.keys(TARGETS).join(', ')})`);

const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  fail(
    `missing required variable(s): ${missing.join(', ')}.\n` +
      `  Set them in the deployment environment before building the production client.\n` +
      `  See docs/DEPLOYMENT.md.`,
  );
}

const apiUrl = process.env.API_URL.trim().replace(/\/+$/, '');

let parsed;
try {
  parsed = new URL(apiUrl);
} catch {
  fail(`API_URL is not a valid absolute URL: "${apiUrl}"`);
}

// Cookies carrying the session are issued with `Secure`, so a plain-HTTP API can never hold a
// session. Catching it here turns a mystifying "logged out immediately" bug into a build error.
if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
  fail(`API_URL must use https (got "${parsed.protocol}//"). Session cookies are Secure-only.`);
}

const siteKey = process.env.RECAPTCHA_V3_SITE_KEY.trim();
const vapidKey = (process.env.VAPID_PUBLIC_KEY ?? '').trim();
const mapsKey = (process.env.GOOGLE_MAPS_API_KEY ?? '').trim();
const posUrl = (process.env.POS_URL ?? '').trim() || '/pos/';
const erpUrl = (process.env.ERP_URL ?? '').trim() || '/';

/** Escape for embedding inside a single-quoted TypeScript string literal. */
const lit = (value) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const HEADER = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Written by tools/generate-environment.mjs from the deployment's own variables at build time.
 * Editing it here has no effect: the next production build overwrites it.
 */
`;

const contents =
  APP === 'pos'
    ? `${HEADER}export const environment = {
  production: true,
  apiUrl: ${lit(apiUrl)},
  erpUrl: ${lit(erpUrl)},
  recaptchaSiteKey: ${lit(siteKey)},
};
`
    : `${HEADER}export const environment = {
  production: true,
  apiUrl: ${lit(apiUrl)},
  posUrl: ${lit(posUrl)},
  vapidPublicKey: ${lit(vapidKey)},
  recaptcha: {
    siteKey: ${lit(siteKey)},
  },
  googleMapsApiKey: ${lit(mapsKey)},
};
`;

writeFileSync(TARGET, contents, 'utf8');
console.log(`generate-environment: wrote ${APP} production environment (apiUrl=${apiUrl})`);
