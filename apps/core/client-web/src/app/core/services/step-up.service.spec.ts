import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ApplicationRef, ViewContainerRef, createComponent } from '@angular/core';
import { of } from 'rxjs';

import { StepUpService, StepUpScope } from './step-up.service';
import {
  PasswordConfirmModalComponent,
  StepUpFactor,
} from '../../shared/components/password-confirm-modal/password-confirm-modal.component';
import { environment } from '../../../environments/environment';

/**
 * The federated branch of step-up had no test, and that is precisely why it shipped broken:
 * the server answered `factor: 'sso'`, the client's union did not contain that value, and the
 * prompt fell through to a password field an SSO account cannot fill. Every assertion here
 * exists to make that specific class of drift fail loudly.
 */
describe('StepUpService', () => {
  let service: StepUpService;
  let http: HttpTestingController;
  let vcr: ViewContainerRef;
  let redirect: jest.SpyInstance;
  let currentPath: jest.SpyInstance;
  const api = `${environment.apiUrl}/auth`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [StepUpService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(StepUpService);
    http = TestBed.inject(HttpTestingController);

    // A real ViewContainerRef, so the modal is genuinely instantiated rather than mocked away.
    const appRef = TestBed.inject(ApplicationRef);
    const host = createComponent(PasswordConfirmModalComponent, {
      environmentInjector: appRef.injector,
    });
    vcr = host.injector.get(ViewContainerRef);
    sessionStorage.clear();

    // Leaving the page and reading it are the service's two seams onto `window.location`, which
    // jsdom does not let a test redefine. Intercepting them here is what makes the destination
    // of the federated redirect assertable.
    redirect = jest.spyOn(service as never, 'redirect').mockImplementation(() => undefined);
    currentPath = jest
      .spyOn(service as never, 'currentPath')
      .mockReturnValue('/settings/security' as never);
  });

  afterEach(() => http.verify());

  /**
   * Answer the status probe, then the challenge, and hand back the modal the service created.
   *
   * `ViewContainerRef.get()` returns a `ViewRef`, which has no `instance`, so the component is
   * captured by intercepting `createComponent` and letting it through.
   */
  function openPrompt(
    scope: StepUpScope,
    challenge: { factor: StepUpFactor; ssoStartPath?: string; idpName?: string },
    action = () => of('done'),
  ) {
    let instance!: PasswordConfirmModalComponent;
    const create = vcr.createComponent.bind(vcr);
    jest.spyOn(vcr, 'createComponent').mockImplementation(((component: never) => {
      const ref = create(component);
      instance = ref.instance as PasswordConfirmModalComponent;
      return ref;
    }) as never);

    const emitted: string[] = [];
    service.requireStepUp(scope, vcr, action).subscribe({
      next: (v) => emitted.push(v as string),
    });

    http.expectOne((r) => r.url === `${api}/step-up/status`).flush({ valid: false });
    http.expectOne(`${api}/step-up/challenge`).flush(challenge);

    return { emitted, get instance() { return instance; } };
  }

  it('runs the action immediately when a proof for the scope is already held', () => {
    const action = jest.fn(() => of('ran'));
    const seen: string[] = [];
    service.requireStepUp(StepUpScope.MANAGE_USERS, vcr, action).subscribe((v) => seen.push(v));

    const req = http.expectOne((r) => r.url === `${api}/step-up/status`);
    expect(req.request.params.get('scope')).toBe(StepUpScope.MANAGE_USERS);
    req.flush({ valid: true });

    expect(action).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(['ran']);
    // No prompt, and crucially no second challenge round-trip.
    http.expectNone(`${api}/step-up/challenge`);
  });

  it('sends a federated account to its identity provider instead of asking for a password', () => {
    currentPath.mockReturnValue('/settings/billing?tab=plan' as never);

    const { instance } = openPrompt(StepUpScope.MANAGE_PAYMENT, {
      factor: 'sso',
      ssoStartPath: '/auth/step-up/sso',
      idpName: 'Okta',
    });

    // The prompt must render as a hand-off, not as a credential form.
    expect(instance.factor).toBe('sso');
    expect(instance.isFederated).toBe(true);
    expect(instance.needsCredential).toBe(false);
    expect(instance.cannotStepUp).toBe(false);
    expect(instance.idpName).toBe('Okta');

    instance.onConfirm();

    expect(redirect).toHaveBeenCalledTimes(1);
    const target = new URL(redirect.mock.calls[0][0] as string, 'http://localhost');
    expect(target.pathname).toContain('/auth/step-up/sso');
    expect(target.searchParams.get('scope')).toBe(StepUpScope.MANAGE_PAYMENT);
    // The page the user was on travels with the request so the server can bring them back.
    expect(target.searchParams.get('returnTo')).toBe('/settings/billing?tab=plan');
    // And no credential was ever POSTed.
    http.expectNone(`${api}/step-up`);
  });

  it('remembers the pending scope across the redirect and consumes it once', () => {
    const { instance } = openPrompt(StepUpScope.ENABLE_2FA, { factor: 'sso' });
    instance.onConfirm();

    expect(service.consumePendingScope()).toBe(StepUpScope.ENABLE_2FA);
    expect(service.consumePendingScope()).toBeNull();
  });

  it('still collects a TOTP code when the account uses one', () => {
    const { emitted, instance } = openPrompt(StepUpScope.DISABLE_2FA, { factor: 'otp' });

    expect(instance.needsCredential).toBe(true);
    instance.credential.set('123456');
    instance.onConfirm();

    const req = http.expectOne(`${api}/step-up`);
    expect(req.request.body).toEqual({ scope: StepUpScope.DISABLE_2FA, otpCode: '123456' });
    req.flush({ success: true });

    expect(emitted).toEqual(['done']);
  });

  it('still collects a password when the account has one', () => {
    const { emitted, instance } = openPrompt(StepUpScope.CHANGE_EMAIL, { factor: 'password' });

    instance.credential.set('hunter2');
    instance.onConfirm();

    const req = http.expectOne(`${api}/step-up`);
    expect(req.request.body).toEqual({ scope: StepUpScope.CHANGE_EMAIL, password: 'hunter2' });
    req.flush({ success: true });

    expect(emitted).toEqual(['done']);
  });

  it('falls back to a password prompt when the challenge call fails', () => {
    let instance!: PasswordConfirmModalComponent;
    const create = vcr.createComponent.bind(vcr);
    jest.spyOn(vcr, 'createComponent').mockImplementation(((component: never) => {
      const ref = create(component);
      instance = ref.instance as PasswordConfirmModalComponent;
      return ref;
    }) as never);

    service.requireStepUp(StepUpScope.MANAGE_USERS, vcr, () => of('done')).subscribe();

    http.expectOne((r) => r.url === `${api}/step-up/status`).flush({ valid: false });
    http
      .expectOne(`${api}/step-up/challenge`)
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(instance.factor).toBe('password');
  });

  it('treats a failed status probe as "not verified" rather than blocking the user', () => {
    const action = jest.fn(() => of('ran'));
    service.requireStepUp(StepUpScope.REVOKE_SESSION, vcr, action).subscribe();

    http
      .expectOne((r) => r.url === `${api}/step-up/status`)
      .flush('nope', { status: 500, statusText: 'Server Error' });
    // It proceeds to the normal prompt instead of failing the action outright.
    http.expectOne(`${api}/step-up/challenge`).flush({ factor: 'password' });
    expect(action).not.toHaveBeenCalled();
  });
});
