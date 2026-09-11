export const environment = {
  production: true,
  // Same-origin by default: the POS app is served behind the same host as the API so the
  // host-only session and CSRF cookies are attached. Override at build time if fronted differently.
  apiUrl: '/api/v1',
};
