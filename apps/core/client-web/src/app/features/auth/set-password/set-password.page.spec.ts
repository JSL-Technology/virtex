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
import { PasswordValidatorComponent } from '../components/password-validator/password-validator.component';

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
        PasswordValidatorComponent
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
    }).compileComponents();

    fixture = TestBed.createComponent(SetPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
