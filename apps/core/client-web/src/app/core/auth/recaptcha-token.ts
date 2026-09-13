import { Observable, of } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';
import type { ReCaptchaV3Service } from 'ng-recaptcha-19';

/**
 * How long a reCAPTCHA token may take before the form gives up on it.
 *
 * Google's own budget for `grecaptcha.execute` is well under a second on a working connection;
 * eight is generous enough that a slow network still gets a real token, and short enough that a
 * blocked one does not read as a frozen page.
 */
export const RECAPTCHA_TIMEOUT_MS = 8000;

/**
 * A reCAPTCHA token, or an empty string when one cannot be obtained.
 *
 * `ReCaptchaV3Service.execute()` resolves only once `grecaptcha` has loaded from Google. When that
 * script never arrives — an ad blocker, a corporate proxy, an offline-ish network, a country where
 * Google is unreachable — the observable emits nothing AND errors nothing: it simply never
 * completes. Every caller subscribed to it directly, so the submit button stayed disabled on its
 * spinner forever, no request was sent, and no error was shown. The form was dead, and nothing on
 * screen said why.
 *
 * Two decisions make that impossible here:
 *
 *   1. `timeout` turns "never" into a failure, which is the only thing the UI can act on.
 *   2. The failure degrades to an empty token instead of aborting the submit, because the SERVER
 *      decides whether a token is required (`RECAPTCHA_DISABLED` drives the guard's `skipIf`).
 *      Where it is not required the user simply signs in; where it is, the request is rejected and
 *      the user reads the server's message. Either way they get an answer instead of a dead button.
 */
export function recaptchaToken$(
  service: ReCaptchaV3Service | null | undefined,
  action: string,
): Observable<string> {
  if (!service) {
    return of('');
  }

  return service.execute(action).pipe(
    timeout(RECAPTCHA_TIMEOUT_MS),
    catchError(() => of('')),
  );
}
