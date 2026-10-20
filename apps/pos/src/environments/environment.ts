/**
 * Local development: the API on :3000 and the ERP on :4200, each its own dev server. The three share
 * the `localhost` host, so the session and CSRF cookies — host-only, port-blind — are common to all
 * of them: signing in on either application signs in on both.
 */
export const environment = {
  production: false,
  apiUrl: 'http://localhost:3000/api/v1',
  /** The ERP, for the «back office» link. */
  erpUrl: 'http://localhost:4200',
  /** Empty: reCAPTCHA is off in development (`RECAPTCHA_DISABLED` defaults to true there). */
  recaptchaSiteKey: '',
};
