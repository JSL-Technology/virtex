import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { RECAPTCHA_V3_SITE_KEY } from 'ng-recaptcha-19';

import { LoginPage } from './login/login.page';

/**
 * Being sent back to the sign-in page with nothing said is indistinguishable from having clicked
 * the wrong thing.
 *
 * Observed: when the session was lost entirely, the application returned to the sign-in page
 * cleanly and silently. The reader cannot tell whether their session timed out, whether something
 * they typed was refused, or whether the work they had open was saved. Two of the three ways a
 * session ends are not their doing, and now say so on the page they land on.
 */
describe('Sign-in page — why the last session ended', () => {
  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'auth/login', component: LoginPage }]),
        // The page provides `ReCaptchaV3Service` itself, and that service needs a site key. The
        // application supplies one from the environment; nothing here executes reCAPTCHA.
        { provide: RECAPTCHA_V3_SITE_KEY, useValue: 'test-site-key' },
      ],
    });
  });

  const openWith = async (query: string) => {
    const harness = await RouterTestingHarness.create(`/auth/login${query}`);
    return harness.routeDebugElement?.componentInstance as LoginPage;
  };

  it('explains a session that expired', async () => {
    const page = await openWith('?reason=expired');
    expect(page.notice()).toBe('login.notice.session_expired');
  });

  it('explains a sign-out after inactivity', async () => {
    const page = await openWith('?reason=idle');
    expect(page.notice()).toBe('login.notice.signed_out_idle');
  });

  it('says nothing when the user signed out on purpose', async () => {
    // A deliberate sign-out carries no reason: there is nothing to explain to somebody who
    // pressed "Sign out", and a message there would be noise.
    const page = await openWith('');
    expect(page.notice()).toBeNull();
  });

  it('says nothing for a reason it does not recognise', async () => {
    const page = await openWith('?reason=something-else');
    expect(page.notice()).toBeNull();
  });

  it('keeps the notice separate from the error banner', async () => {
    // Not an error: nothing was typed wrong and nothing can be retried differently. The two must
    // not share a channel, or an expired session would be dressed in the colours of a mistake.
    const page = await openWith('?reason=expired');
    expect(page.notice()).toBe('login.notice.session_expired');
    expect(page.errorMessage()).toBeNull();
  });

  it('still reports a social sign-in failure as an error', async () => {
    const page = await openWith('?error=access_denied');
    expect(page.errorMessage()).toBeTruthy();
    expect(page.notice()).toBeNull();
  });
});
