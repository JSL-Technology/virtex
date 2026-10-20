/**
 * Production environment.
 *
 * The point of sale is served on the SAME ORIGIN as the API and the ERP — by default under `/pos/`
 * (see docs/pos.md, "Deployment"). Same origin is what lets the host-only session and CSRF cookies
 * reach it, and it is also what makes the two applications one sign-in.
 *
 * `tools/generate-environment.mjs --app=pos` rewrites this file from the deployment's own variables
 * before `nx build pos --configuration=production`; the defaults below are the same-origin layout
 * and are usable as they are, except for reCAPTCHA, which the generator fills in.
 */
export const environment = {
  production: true,
  apiUrl: '/api/v1',
  erpUrl: '/',
  recaptchaSiteKey: '',
};
