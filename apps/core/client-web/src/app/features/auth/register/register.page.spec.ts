
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { RegisterPage } from './register.page';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../core/services/auth';
import { ReCaptchaV3Service } from 'ng-recaptcha-19';
import { of, Observable } from 'rxjs';
import { CountryService } from '../../../core/services/country.service';
import { LanguageService } from '../../../core/services/language';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { UsersService } from '../../../core/api/users.service';
import { GeoLocationService } from '../../../core/services/geo-location.service';
import { ConfigService, RegistrationOptions } from '../../../shared/services/config.service';

// Import standalone components used in template to ensure they are available
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { StepAccountInfo } from './steps/step-account-info/step-account-info';
import { StepBusiness } from './steps/step-business/step-business';
import { StepConfiguration } from './steps/step-configuration/step-configuration';
import { StepPlan } from './steps/step-plan/step-plan';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { environment } from '../../../../environments/environment';

// Fake Loader for Translate
class FakeLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<any> {
    return of({});
  }
}

// Mocks
class MockAuthService {
  register = jest.fn().mockReturnValue(of({}));
  currentUser = jest.fn().mockReturnValue(null);
  getSocialRegisterInfo = jest.fn().mockReturnValue(of({}));
}
class MockRecaptchaService {
  execute = jest.fn().mockReturnValue(of('mock-token'));
}
class MockCountryService {
  currentCountry = jest.fn().mockReturnValue({ code: 'DO', currencyCode: 'DOP', name: 'Dominican Republic', formSchema: {} });
  currentCountryCode = jest.fn().mockReturnValue('do');
  detectAndSetCountry = jest.fn();
  getCountryConfig = jest.fn().mockReturnValue(of({}));
  lookupTaxId = jest.fn().mockReturnValue(of(null));
}
class MockUsersService {
    updateUser = jest.fn().mockReturnValue(of({}));
}
class MockLanguageService {
    // The component accesses languageService.currentLang() as a Signal.
    // In the template it is accessed as function call {{ languageService.currentLang() }}
    // The previous error "Cannot read properties of undefined (reading 'currentLang')"
    // implies it might be accessed differently or the injection is missing.
    // However, looking at the template: [routerLink]="['/', languageService.currentLang(), 'auth', 'login']"
    // Since LanguageService is injected as public property, we just need to ensure the mock has the method.
    // If it's a Signal, it's a function.
    currentLang = jest.fn().mockReturnValue('es');
}

class MockGeoLocationService {
    getGeoLocation = jest.fn().mockReturnValue(of({ country: 'DO' }));
    mismatchSignal = jest.fn().mockReturnValue(null);
}

class MockConfigService {
    getRegistrationOptions = jest.fn().mockReturnValue(of({
        industries: ['tech'],
        companySizes: ['1-10']
    }));
}

describe('RegisterPage', () => {
  let component: RegisterPage;
  let fixture: ComponentFixture<RegisterPage>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RegisterPage, // Standalone
        NoopAnimationsModule,
        TranslateModule.forRoot({
            loader: { provide: TranslateLoader, useClass: FakeLoader }
        }),
        // Mock components that might be in the template but not mocked
        // Actually they are imports in RegisterPage, so they are used.
        // We can override them if they are complex, but for now importing them via RegisterPage is fine.
      ],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: ReCaptchaV3Service, useClass: MockRecaptchaService },
        { provide: CountryService, useClass: MockCountryService },
        { provide: UsersService, useClass: MockUsersService },
        { provide: LanguageService, useClass: MockLanguageService },
        { provide: GeoLocationService, useClass: MockGeoLocationService },
        { provide: ConfigService, useClass: MockConfigService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;

    // Explicitly inject LanguageService to debug
    const langService = TestBed.inject(LanguageService);
    // Ensure the public property on component is set if it wasn't auto-injected (though inject() handles it)
    // component.languageService = langService; // inject() handles this.

    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form with default country values', () => {
    expect(component.registerForm).toBeDefined();
    // In MockCountryService we return 'DO'
    // effect() runs asynchronously or during change detection.
    // We called fixture.detectChanges() in beforeEach.
    expect(component.configuration.get('country')?.value).toBe('DO');
    expect(component.configuration.get('currency')?.value).toBe('DOP');
  });

  it('should validate required fields', fakeAsync(() => {
    const accountInfo = component.accountInfo;

    // Check initial invalid state
    expect(accountInfo.valid).toBeFalsy();

    // Fill with valid data
    accountInfo.patchValue({
      firstName: 'John',
      lastName: 'Doe',
      email: 'test@example.com',
      passwordGroup: {
        password: 'Password123!',
        confirmPassword: 'Password123!'
      }
    });

    // Advance time for async validator debounce/timer (500ms)
    tick(500);

    // Expect the HTTP request for email validation
    const req = httpMock.expectOne(`${environment.apiUrl}/common/users/exists?email=test@example.com`);
    expect(req.request.method).toBe('HEAD');

    // Respond with 404 (User not found -> Valid for registration)
    req.flush(null, { status: 404, statusText: 'Not Found' });

    // Update validity
    fixture.detectChanges();

    // Should be valid now
    expect(accountInfo.valid).toBeTruthy();
  }));
});
