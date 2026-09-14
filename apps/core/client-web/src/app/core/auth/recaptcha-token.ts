import { Observable, Subject, of, race } from 'rxjs';
import { catchError, take, timeout } from 'rxjs/operators';
import type { ReCaptchaV3Service } from 'ng-recaptcha-19';

/**
 * How long a reCAPTCHA token may take before the form gives up on it.
 *
 * Google's own budget for `grecaptcha.execute` is well under a second on a working connection;
 * eight is generous enough that a slow network still gets a real token, and short enough that a
 * blocked one does not read as a frozen page. It is the ceiling, not the expected wait: see
 * `scriptFailure$` below for the case that used to spend all eight seconds.
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
 * Three decisions make that impossible here:
 *
 *   1. `timeout` turns "never" into a failure, which is the only thing the UI can act on.
 *   2. The failure degrades to an empty token instead of aborting the submit, because the SERVER
 *      decides whether a token is required (`RECAPTCHA_DISABLED` drives the guard's `skipIf`).
 *      Where it is not required the user simply signs in; where it is, the request is rejected and
 *      the user reads the server's message. Either way they get an answer instead of a dead button.
 *   3. A script that FAILS to load is not waited on at all — see below.
 */
export function recaptchaToken$(
  service: ReCaptchaV3Service | null | undefined,
  action: string,
): Observable<string> {
  if (!service) {
    return of('');
  }

  return race(
    service.execute(action),
    scriptFailure$(),
  ).pipe(
    take(1),
    timeout(RECAPTCHA_TIMEOUT_MS),
    catchError(() => of('')),
  );
}

/**
 * Whether Google's script has been seen to fail, and a way to hear about it happening.
 *
 * This has to be armed at application START, which is the part the first attempt at this got
 * wrong. Measured in the browser: the reCAPTCHA library appends the script 0.1 s after the page
 * loads and the fetch fails about 50 ms later — long before anybody has typed a password. Waiting
 * until the submit to attach an `error` listener attaches it to an element whose error fired
 * seconds ago and will never fire again, so the eight-second ceiling went on doing all the work.
 *
 * Nor can the state be inferred at submit time. "No `grecaptcha` and a script element present"
 * describes a script that failed AND a script that is still downloading on a bad connection, and
 * treating the second as the first would throw away a token that was about to arrive — degrading a
 * slow sign-in into a rejected one. The event is the only thing that distinguishes them, so the
 * event is what is recorded.
 */
let scriptFailed = false;
const scriptFailure = new Subject<string>();

/** The host Google serves `api.js` from; how the script element is recognised in the document. */
const RECAPTCHA_SCRIPT = 'recaptcha/api.js';

/**
 * Start listening for a reCAPTCHA script that fails to load. Call once, at application start.
 *
 * Returns a teardown, which nothing in the application uses — the watch lasts as long as the page
 * does — and which the tests need in order not to leak an observer between cases.
 */
export function watchRecaptchaScript(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') {
    return () => undefined;
  }

  const cleanups: (() => void)[] = [];
  const onError = () => {
    scriptFailed = true;
    scriptFailure.next('');
  };

  const watch = (script: HTMLScriptElement) => {
    script.addEventListener('error', onError);
    cleanups.push(() => script.removeEventListener('error', onError));
  };

  document.querySelectorAll<HTMLScriptElement>(`script[src*="${RECAPTCHA_SCRIPT}"]`).forEach(watch);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLScriptElement && node.src.includes(RECAPTCHA_SCRIPT)) {
          watch(node);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  return () => {
    observer.disconnect();
    cleanups.forEach((off) => off());
    scriptFailed = false;
  };
}

/** Test seam: forget that a script ever failed. */
export function resetRecaptchaScriptWatchForTests(): void {
  scriptFailed = false;
}

/**
 * Emits `''` — the same "no token" the timeout degrades to — the moment the script is known to
 * have failed, or at once if it already has.
 *
 * Not an error, because a blocked reCAPTCHA is not the user's problem to solve and not a reason to
 * refuse their sign-in.
 */
function scriptFailure$(): Observable<string> {
  return scriptFailed ? of('') : scriptFailure.asObservable();
}
