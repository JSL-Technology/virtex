/**
 * Production environment.
 *
 * Values are injected at build time by `tools/generate-environment.mjs`, which reads the
 * deployment's own variables (API_URL, RECAPTCHA_V3_SITE_KEY, VAPID_PUBLIC_KEY) and rewrites
 * this file before `nx build client-web --configuration=production` runs. The literals below
 * are the placeholders the generator replaces; they are deliberately NOT usable values, so a
 * build that skipped the generator fails loudly at startup instead of silently shipping a
 * client pointed at localhost.
 *
 * See `docs/DEPLOYMENT.md`.
 */
export const environment = {
  production: true,
  apiUrl: '__API_URL__',
  vapidPublicKey: '__VAPID_PUBLIC_KEY__',
  recaptcha: {
    siteKey: '__RECAPTCHA_V3_SITE_KEY__',
  },
};
