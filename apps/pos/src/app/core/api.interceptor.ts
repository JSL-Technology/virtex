import { HttpInterceptorFn } from '@angular/common/http';
import { readCsrfCookie } from './csrf-token';

/**
 * Attaches the session cookie (`withCredentials`) and the CSRF header to every request — the same
 * contract the API enforces for the web client. The POS app shares the host-only session and CSRF
 * cookies, so a session established here (or in the web client on the same host) is honoured.
 */
export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  let authReq = req.clone({ withCredentials: true });
  const token = readCsrfCookie();
  if (token && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    authReq = authReq.clone({ headers: authReq.headers.set('X-XSRF-TOKEN', token) });
  }
  return next(authReq);
};
