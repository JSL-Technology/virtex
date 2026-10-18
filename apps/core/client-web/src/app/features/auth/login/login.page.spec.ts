import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginPage } from './login.page';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../core/services/auth';
import { ReCaptchaV3Service, RECAPTCHA_V3_SITE_KEY } from 'ng-recaptcha-19';
import { of, Observable } from 'rxjs';
import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { MockCountryService } from '../../../../testing/country.service.mock';
import { CountryService } from '../../../core/services/country.service';
import { LanguageService } from '../../../core/services/language';
import { TranslateLoader, TranslateService } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { SocialAuthButtonsComponent } from '../components/social-auth-buttons/social-auth-buttons.component';
import { PasskeyButtonComponent } from '../components/passkey-button/passkey-button.component';

// Fake Loader for Translate
class FakeLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    return of({});
  }
}

// Mocks
class MockAuthService {
  login = jest.fn().mockReturnValue(of({ user: { id: 1 }, accessToken: 'token' }));
  loginWithPasskey = jest.fn().mockReturnValue(Promise.resolve({ id: 1 }));
  verify2fa = jest.fn().mockReturnValue(of({ user: { id: 1 } }));
}
class MockRecaptchaService {
  execute = jest.fn().mockReturnValue(of('mock-token'));
}
class MockLanguageService {
    currentLang = jest.fn().mockReturnValue('es');
    currentLocale = jest.fn().mockReturnValue('en-US');
    setLanguage = jest.fn();
}

describe('LoginPage', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        LoginPage,
        NoopAnimationsModule,
        TranslateModule.forRoot({
            loader: { provide: TranslateLoader, useClass: FakeLoader }
        }),
        AuthLayoutComponent,
        AuthInputComponent,
        AuthButtonComponent,
        SocialAuthButtonsComponent,
        PasskeyButtonComponent
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: ReCaptchaV3Service, useClass: MockRecaptchaService },
        { provide: RECAPTCHA_V3_SITE_KEY, useValue: 'mock-key' },
        { provide: CountryService, useClass: MockCountryService },
        { provide: LanguageService, useClass: MockLanguageService },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should have invalid form initially', () => {
    expect(component.loginForm.valid).toBeFalsy();
  });

  it('should be valid when filled', () => {
    component.loginForm.patchValue({
        email: 'test@example.com',
        password: 'password123'
    });
    expect(component.loginForm.valid).toBeTruthy();
  });

  /**
   * A federated sign-in no longer skips the account's own second factor: the server opens the
   * pending session and sends the browser here with `?step=2fa`.
   */
  it('opens at the second-factor step when the server sends it there', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/?step=2fa');
    const second = TestBed.createComponent(LoginPage);
    second.detectChanges();
    expect(second.componentInstance.show2faInput()).toBe(true);
  });

  /** QA C-09: the right password on a locked account was answered "incorrect email or password". */
  describe('error messages', () => {
    // The page provides its own reCAPTCHA service, which is asynchronous; the failure path the
    // sign-in subscribes to is exercised directly.
    const submitWith = (error: HttpErrorResponse) =>
      (component as unknown as { handleError(e: unknown): void }).handleError(error);

    it('says a locked account is locked, and for how long', () => {
      submitWith(
        new HttpErrorResponse({
          status: 423,
          error: {
            code: 'AUTH_ACCOUNT_TEMPORARILY_LOCKED',
            messageKey: 'auth.account_temporarily_locked',
            params: { minutes: 12, retryAfterSeconds: 700 },
          },
        }),
      );

      expect(component.errorMessage()).toEqual({
        key: 'login.errors.account_locked',
        params: { when: 'in 12 minutes' },
      });
    });

    it('keeps the generic message for wrong credentials', () => {
      submitWith(
        new HttpErrorResponse({
          status: 401,
          error: { code: 'AUTH_INVALID_CREDENTIALS', messageKey: 'errors.auth_invalid_credentials', params: {} },
        }),
      );

      expect(component.errorMessage()?.key).not.toBe('login.errors.account_locked');
      expect(component.errorMessage()?.params?.['when']).toBeUndefined();
    });

    it('says how long to wait when rate-limited (Retry-After)', () => {
      submitWith(
        new HttpErrorResponse({
          status: 429,
          headers: new HttpHeaders({ 'Retry-After': '60' }),
          error: { code: 'TOO_MANY_REQUESTS', messageKey: 'errors.too_many_requests', params: {} },
        }),
      );

      expect(component.errorMessage()).toEqual({
        key: 'login.errors.too_many_attempts_wait',
        params: { when: 'in 1 minute' },
      });
    });
  });
});
