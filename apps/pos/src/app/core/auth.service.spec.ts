import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService, SignInOutcome } from './auth.service';
import { sessionExpiryInterceptor } from './session-expiry.interceptor';

const AUTH = `${environment.apiUrl}/auth`;
const user = (permissions: string[]) => ({
  id: 'u1',
  email: 'dev@virtex.local',
  organizationId: 'o1',
  permissions,
});

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([sessionExpiryInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        {
          provide: LocaleStore,
          useValue: { setTenantContext: jest.fn(), setLanguage: jest.fn() },
        },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('adopts the session the ERP already holds (one sign-in for both applications)', async () => {
    const result = firstValueFrom(auth.resolveSession());
    http
      .expectOne(`${AUTH}/session`)
      .flush({ authenticated: true, user: user(['*']), refreshable: false });
    expect(await result).toBe(true);
    expect(auth.canAccess()).toBe(true);
    expect(auth.canSupervise()).toBe(true);
  });

  it('renews an expired session instead of sending the cashier to the sign-in screen', async () => {
    const result = firstValueFrom(auth.resolveSession());
    http
      .expectOne(`${AUTH}/session`)
      .flush({ authenticated: false, user: null, refreshable: true });
    http.expectOne(`${AUTH}/refresh`).flush({});
    http
      .expectOne(`${AUTH}/session`)
      .flush({
        authenticated: true,
        user: user(['pos:view']),
        refreshable: false,
      });
    expect(await result).toBe(true);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('signs in and reports no access — and signs back out — when the role lacks the till', async () => {
    const outcome = firstValueFrom(auth.login('acct@x.com', 'secret-password'));
    const login = http.expectOne(`${AUTH}/login`);
    expect(login.request.body).toMatchObject({
      email: 'acct@x.com',
      password: 'secret-password',
      recaptchaToken: '',
    });
    login.flush({ user: {} });
    http
      .expectOne(`${AUTH}/session`)
      .flush({
        authenticated: true,
        user: user(['invoices:view']),
        refreshable: false,
      });
    http.expectOne(`${AUTH}/logout`).flush({});
    expect(await outcome).toBe<SignInOutcome>('no-access');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('asks for the second factor when the account has one', async () => {
    const outcome = firstValueFrom(auth.login('dev@virtex.local', 'x'));
    http.expectOne(`${AUTH}/login`).flush({ require2fa: true });
    expect(await outcome).toBe<SignInOutcome>('second-factor');

    const verified = firstValueFrom(auth.verifySecondFactor('123456'));
    http.expectOne(`${AUTH}/verify-2fa`).flush({});
    http
      .expectOne(`${AUTH}/session`)
      .flush({
        authenticated: true,
        user: user(['pos:view', 'pos:operate']),
        refreshable: false,
      });
    expect(await verified).toBe<SignInOutcome>('signed-in');
  });

  it('a burst of expired requests produces ONE renewal (a second would replay a rotated token)', () => {
    auth.refresh().subscribe();
    auth.refresh().subscribe();
    http.expectOne(`${AUTH}/refresh`).flush({});
  });
});
