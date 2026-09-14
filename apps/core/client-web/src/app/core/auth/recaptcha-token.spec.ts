import { Observable, NEVER, of, throwError } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import type { ReCaptchaV3Service } from 'ng-recaptcha-19';

import {
  recaptchaToken$,
  resetRecaptchaScriptWatchForTests,
  watchRecaptchaScript,
  RECAPTCHA_TIMEOUT_MS,
} from './recaptcha-token';

/**
 * Signing in must not wait on Google.
 *
 * `ReCaptchaV3Service.execute()` resolves only once `grecaptcha` has loaded. When the script never
 * arrives — an ad blocker, a corporate proxy, a country where Google is unreachable — it emits
 * nothing and errors nothing: it never completes. The original callers subscribed to it directly
 * and the submit button sat on its spinner forever.
 *
 * The timeout below fixed the hang. It did not fix the wait: measured against a machine with no
 * route to Google, signing in showed "Logging in" for the full eight seconds before the request
 * left the browser. The browser had known within milliseconds — it fires `error` on the script
 * element — and nobody was listening.
 */
describe('reCAPTCHA token', () => {
  const service = (execute: Observable<string>) =>
    ({ execute: () => execute }) as unknown as ReCaptchaV3Service;

  /** The script element as the reCAPTCHA library appends it. */
  const appendScript = (): HTMLScriptElement => {
    const script = document.createElement('script');
    script.src = 'https://www.google.com/recaptcha/api.js?render=site-key';
    document.head.appendChild(script);
    return script;
  };

  let stopWatch: () => void = () => undefined;

  beforeEach(() => {
    resetRecaptchaScriptWatchForTests();
    // What `app.config.ts` does at application start, and what the whole point of this is: the
    // watch is armed before any script element exists.
    stopWatch = watchRecaptchaScript();
  });

  afterEach(() => {
    stopWatch();
    document
      .querySelectorAll('script[src*="recaptcha/api.js"]')
      .forEach((script) => script.remove());
  });

  it('passes a real token straight through', async () => {
    await expect(firstValueFrom(recaptchaToken$(service(of('token-abc')), 'login'))).resolves.toBe(
      'token-abc',
    );
  });

  it('answers with no token when the service is not available at all', async () => {
    await expect(firstValueFrom(recaptchaToken$(null, 'login'))).resolves.toBe('');
  });

  it('answers with no token when execute() fails', async () => {
    const failing = service(throwError(() => new Error('grecaptcha exploded')));
    await expect(firstValueFrom(recaptchaToken$(failing, 'login'))).resolves.toBe('');
  });

  it('gives up the moment the browser says the script could not be fetched', async () => {
    jest.useFakeTimers();
    try {
      // `NEVER`: exactly what the library does when `grecaptcha` has not loaded.
      const pending = firstValueFrom(recaptchaToken$(service(NEVER), 'login'));

      const script = appendScript();
      // The MutationObserver is asynchronous; let it see the element before the error fires.
      await Promise.resolve();
      script.dispatchEvent(new Event('error'));

      // Resolved with the clock frozen: no timer was advanced, so the eight-second ceiling is
      // not what ended the wait. That is the whole point of this case.
      await expect(pending).resolves.toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('answers at once when the script failed long before the user pressed sign in', async () => {
    // The real sequence, and the one the first attempt at this fix got wrong: the library appends
    // the script as the page loads, it fails ~50 ms later, and the user types their password for
    // several seconds afterwards. By submit time the `error` event is long past.
    const script = appendScript();
    await Promise.resolve();
    script.dispatchEvent(new Event('error'));

    jest.useFakeTimers();
    try {
      await expect(firstValueFrom(recaptchaToken$(service(NEVER), 'login'))).resolves.toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('still gives up on its own when nothing ever fails and nothing ever answers', async () => {
    jest.useFakeTimers();
    try {
      const pending = firstValueFrom(recaptchaToken$(service(NEVER), 'login'));
      jest.advanceTimersByTime(RECAPTCHA_TIMEOUT_MS + 1);
      await expect(pending).resolves.toBe('');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a working script leaves the failure flag alone, so the next sign-in waits properly', async () => {
    appendScript();
    await Promise.resolve();

    await expect(firstValueFrom(recaptchaToken$(service(of('token-abc')), 'login'))).resolves.toBe(
      'token-abc',
    );

    // Nothing failed, so a subsequent attempt must still be willing to wait for a real token
    // rather than short-circuiting to an empty one.
    jest.useFakeTimers();
    try {
      const pending = firstValueFrom(recaptchaToken$(service(NEVER), 'login'));
      let settled = false;
      void pending.then(() => { settled = true; });
      jest.advanceTimersByTime(RECAPTCHA_TIMEOUT_MS - 1);
      await Promise.resolve();
      expect(settled).toBe(false);

      jest.advanceTimersByTime(2);
      await expect(pending).resolves.toBe('');
    } finally {
      jest.useRealTimers();
    }
  });
});
