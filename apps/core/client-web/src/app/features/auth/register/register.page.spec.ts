
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RegisterPage } from './register.page';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../core/services/auth';
import { ReCaptchaV3Service } from 'ng-recaptcha-19';
import { of, Observable } from 'rxjs';
import { CountryService } from '../../../core/services/country.service';
import { MockCountryService, US_CONFIG } from '../../../../testing/country.service.mock';
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
  let countryService: MockCountryService;

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
    countryService = TestBed.inject(CountryService) as unknown as MockCountryService;
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

  it('should validate required fields', () => {
    const accountInfo = component.accountInfo;
    expect(accountInfo.valid).toBe(false);

    accountInfo.patchValue({
      firstName: 'John',
      lastName: 'Doe',
      email: 'test@example.com',
      emailCode: '123456',
      phone: '+18090000000',
      phoneCode: '123456',
      passwordGroup: { password: 'Password123!Strong', confirmPassword: 'Password123!Strong' },
    });

    expect(accountInfo.valid).toBe(true);
  });

  /**
   * The fiscal step is where the product's correctness lives. Everything below states a rule the
   * previous form did not enforce.
   */
  describe('fiscal configuration', () => {
    const fillConfiguration = (over: Record<string, unknown> = {}) =>
      component.configuration.patchValue({
        taxId: '131-12345-7',
        address: 'Av. Winston Churchill 1099',
        city: 'Santo Domingo',
        state: '01',
        ...over,
      });

    it('applies the selected country tax-id pattern, not a permissive fallback', () => {
      fillConfiguration({ taxId: 'not-a-tax-id' });
      expect(component.configuration.get('taxId')?.valid).toBe(false);

      fillConfiguration();
      expect(component.configuration.get('taxId')?.valid).toBe(true);
    });

    it('requires the whole fiscal address', () => {
      fillConfiguration({ address: '', city: '', state: '' });
      expect(component.configuration.get('address')?.valid).toBe(false);
      expect(component.configuration.get('city')?.valid).toBe(false);
      expect(component.configuration.get('state')?.valid).toBe(false);
    });

    it('does not require a postal code where the country does not', () => {
      fillConfiguration();
      expect(component.configuration.valid).toBe(true);
    });

    it('requires a postal code once a country that needs one is selected', () => {
      // United States sales tax is destination-based: no ZIP, no rate.
      countryService.setConfig(US_CONFIG);
      fixture.detectChanges();

      fillConfiguration({ taxId: '12-3456789', state: 'TX', postalCode: '' });
      expect(component.configuration.get('postalCode')?.valid).toBe(false);

      component.configuration.patchValue({ postalCode: '78701' });
      expect(component.configuration.get('postalCode')?.valid).toBe(true);
    });

    it('clears a division code that belongs to the previous country', () => {
      fillConfiguration({ state: '01' }); // a Dominican province
      countryService.setConfig(US_CONFIG);
      fixture.detectChanges();
      expect(component.configuration.get('state')?.value).toBe('');
    });

    it('takes the fiscal region id from the country, never from user input', () => {
      expect(component.configuration.get('fiscalRegionId')?.value).toBe(
        '11111111-1111-4111-8111-111111111111',
      );
    });

    it('refuses to advance past the fiscal step with no fiscal region, for ANY country', () => {
      // The old check listed four countries by hand, so the other four the form offered advanced
      // with no region and produced a tenant with no chart of accounts.
      component.configuration.get('fiscalRegionId')?.setValue(null);
      fillConfiguration();
      component.currentStep.set(4);
      component.nextStep();

      expect(component.currentStep()).toBe(4);
      // The message is a translation key now: the wizard used to carry Spanish literals, which
      // a US customer would have read in Spanish regardless of the language they chose.
      expect(component.errorMessage()).toBe('REGISTER.ERRORS.COUNTRY_CONFIG');
    });
  });
});
