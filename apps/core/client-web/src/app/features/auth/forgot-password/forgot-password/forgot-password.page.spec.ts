import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForgotPasswordPage } from './forgot-password.page';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../../core/services/auth';
import { ReCaptchaV3Service } from 'ng-recaptcha-19';
import { of, Observable } from 'rxjs';
import { LanguageService } from '../../../../core/services/language';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { AuthLayoutComponent } from '../../components/auth-layout/auth-layout.component';
import { AuthInputComponent } from '../../components/auth-input/auth-input.component';
import { AuthButtonComponent } from '../../components/auth-button/auth-button.component';

class FakeLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    return of({});
  }
}

class MockAuthService {
  forgotPassword = jest.fn().mockReturnValue(of({ message: 'Success' }));
}
class MockRecaptchaService {
  execute = jest.fn().mockReturnValue(of('mock-token'));
}
class MockLanguageService {
    currentLang = jest.fn().mockReturnValue('es');
}

describe('ForgotPasswordPage', () => {
  let component: ForgotPasswordPage;
  let fixture: ComponentFixture<ForgotPasswordPage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        ForgotPasswordPage,
        NoopAnimationsModule,
        TranslateModule.forRoot({
            loader: { provide: TranslateLoader, useClass: FakeLoader }
        }),
        AuthLayoutComponent,
        AuthInputComponent,
        AuthButtonComponent
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: ReCaptchaV3Service, useClass: MockRecaptchaService },
        { provide: LanguageService, useClass: MockLanguageService },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ForgotPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
