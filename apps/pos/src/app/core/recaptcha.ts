import { Observable, from, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import { environment } from '../../environments/environment';

/**
 * A reCAPTCHA v3 token for the sign-in, or `''`.
 *
 * Same contract as the web client's `recaptchaToken$`: the SERVER decides whether a token is
 * required (`RECAPTCHA_DISABLED`), so a token that cannot be obtained — no site key configured, the
 * script blocked by a proxy, an offline counter — degrades to an empty one instead of freezing the
 * form. Where the server requires it, the sign-in is refused with the server's own message key and
 * the cashier reads why; where it does not, they simply sign in.
 *
 * Loaded by hand rather than through `ng-recaptcha`: the till needs exactly one call, and only on
 * the sign-in screen, so the script is fetched there and nowhere else.
 */
const TIMEOUT_MS = 8000;

interface Grecaptcha {
  ready(callback: () => void): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

let loading: Promise<Grecaptcha> | null = null;

function loadScript(siteKey: string): Promise<Grecaptcha> {
  if (loading) return loading;
  loading = new Promise<Grecaptcha>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error('recaptcha script failed'));
    };
    script.onload = () => {
      const api = (globalThis as { grecaptcha?: Grecaptcha }).grecaptcha;
      if (!api) return reject(new Error('recaptcha unavailable'));
      api.ready(() => resolve(api));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function recaptchaToken$(action: string, siteKey = environment.recaptchaSiteKey): Observable<string> {
  if (!siteKey || typeof document === 'undefined') return of('');
  return from(loadScript(siteKey).then((api) => api.execute(siteKey, { action }))).pipe(
    timeout(TIMEOUT_MS),
    catchError(() => of('')),
  );
}
