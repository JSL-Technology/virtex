import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SetPasswordPage } from './set-password.page';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../core/services/auth';
import { ReCaptchaV3Service, RECAPTCHA_V3_SITE_KEY } from 'ng-recaptcha-19';
import { of, Observable } from 'rxjs';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { PasswordStrengthComponent } from '../../../shared/components/password-strength/password-strength.component';

class FakeLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    return of({});
  }
}

class MockAuthService {
  setPasswordFromInvitation = jest.fn().mockReturnValue(of({ user: {} }));
  getInvitationDetails = jest.fn().mockReturnValue(of({ firstName: 'John' }));
}
class MockRecaptchaService {
  execute = jest.fn().mockReturnValue(of('mock-token'));
}

describe('SetPasswordPage', () => {
  let component: SetPasswordPage;
  let fixture: ComponentFixture<SetPasswordPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        SetPasswordPage,
        NoopAnimationsModule,
        TranslateModule.forRoot({
            loader: { provide: TranslateLoader, useClass: FakeLoader }
        }),
        AuthLayoutComponent,
        AuthInputComponent,
        AuthButtonComponent,
        PasswordStrengthComponent
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        {
            provide: ActivatedRoute,
            useValue: {
                snapshot: {
                    queryParamMap: {
                        get: (key: string) => key === 'token' ? 'valid-token' : null
                    }
                }
            }
        },
        { provide: AuthService, useClass: MockAuthService },
        { provide: ReCaptchaV3Service, useClass: MockRecaptchaService },
        { provide: RECAPTCHA_V3_SITE_KEY, useValue: 'mock-key' },
      ]
    })
      /**
       * `RecaptchaV3Module` is imported by the COMPONENT, so it provides `ReCaptchaV3Service` in
       * the component's own injector and shadows anything the TestBed root provides. Without this
       * override the page gets the real service, which waits for a `grecaptcha` script that never
       * loads under jsdom, and the submit never reaches the auth service at all.
       */
      .overrideComponent(SetPasswordPage, {
        set: {
          providers: [
            { provide: ReCaptchaV3Service, useClass: MockRecaptchaService },
            { provide: RECAPTCHA_V3_SITE_KEY, useValue: 'mock-key' },
          ],
        },
      })
      .compileComponents();

    // The invitation token travels in the URL FRAGMENT, never the query string: a fragment is not
    // sent to the server and not logged by a reverse proxy. The fixture has to set it there.
    window.location.hash = '#token=valid-token';

    fixture = TestBed.createComponent(SetPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  /**
   * The bot check is applied, not merely computed.
   *
   * The page obtained a reCAPTCHA token and called the service without it, so a public,
   * unauthenticated endpoint that issues auth cookies ran with no bot check at all — the control
   * was paid for and thrown away.
   */
  it('sends the reCAPTCHA token it obtained', () => {
    const auth = TestBed.inject(AuthService) as unknown as MockAuthService;

    component.setPasswordForm.patchValue({
      passwordGroup: { password: 'Str0ng-Pass!', confirmPassword: 'Str0ng-Pass!' },
    });
    component.onSubmit();

    expect(auth.setPasswordFromInvitation).toHaveBeenCalledWith(
      'valid-token',
      'Str0ng-Pass!',
      'mock-token',
    );
  });
});
