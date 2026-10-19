import { LEGAL_DOCUMENTS } from '@virteex/shared/types';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RegisterPage } from './register.page';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../core/services/auth';
import { ReCaptchaV3Service } from 'ng-recaptcha-19';
import { of, throwError, Observable } from 'rxjs';
import { CountryService } from '../../../core/services/country.service';
import { MockCountryService, US_CONFIG } from '../../../../testing/country.service.mock';
import { LanguageService } from '../../../core/services/language';
import { TranslateLoader } from '@ngx-translate/core';
import { TranslateModule } from '@virteex/shared/ui-i18n';
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
import { TRANSLATE_STORE_PROVIDERS, apiError, useCatalogue } from '../../../../testing/api-errors';

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
        // Mock components that might be in the template but not mocked
        // Actually they are imports in RegisterPage, so they are used.
        // We can override them if they are complex, but for now importing them via RegisterPage is fine.
      ],
      providers: [
        provideTranslateLoader(FakeLoader),
        ...TRANSLATE_STORE_PROVIDERS,
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
    });

    // `RegisterPage` declares its own `ReCaptchaV3Service` provider (component-level), which
    // shadows the root mock and would otherwise load the real grecaptcha script. Adding the mock
    // to the component's own providers makes it win (last provider for a token wins), so
    // `execute()` resolves synchronously and `onSubmit` can be exercised.
    TestBed.overrideComponent(RegisterPage, {
      add: { providers: [{ provide: ReCaptchaV3Service, useClass: MockRecaptchaService }] },
    });

    await TestBed.compileComponents();

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
      // A real, valid E.164 number: the phone field now validates with libphonenumber (via
      // IntlPhoneInputComponent), so a placeholder like +18090000000 would be correctly rejected.
      phone: '+18092345678',
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

    it('advances past the fiscal step with a supported country even when no fiscalRegionId is present', () => {
      // The country is the authoritative fiscal field: the server derives the region, chart of
      // accounts and taxes from `countryCode` and ignores any `fiscalRegionId` the client sends.
      // Gating on `fiscalRegionId` blocked fully-valid, supported countries whenever the catalogue
      // did not carry the id — so a null region must NOT stop the wizard.
      component.configuration.get('fiscalRegionId')?.setValue(null);
      fillConfiguration();
      component.currentStep.set(4);
      component.nextStep();

      expect(component.currentStep()).toBe(5);
      expect(component.errorMessage()).toBeNull();
    });

    it('refuses to advance past the fiscal step until the country configuration has loaded', () => {
      // The meaningful failure is a country whose configuration is not available — without it there
      // is nothing to validate the fiscal fields against. This is what the gate now checks.
      fillConfiguration();
      countryService.setConfig(null);
      component.currentStep.set(4);
      component.nextStep();

      expect(component.currentStep()).toBe(4);
      // The message is a translation key now: the wizard used to carry Spanish literals, which
      // a US customer would have read in Spanish regardless of the language they chose.
      expect(component.errorMessage()).toBe('register.errors.we_couldn_load_tax_settings_country');
    });
  });

  describe('submit errors', () => {
    it('shows the reason the server gives, in the reader\'s language', () => {
      // The API sends `messageKey` and `params`, never a sentence and never `message`. Reading
      // `error.message` meant a rejected RNC/RFC/NIT always produced «unknown error», so the
      // customer was never told which field to fix.
      const rejection =
        'El RNC / Cédula no es válido para una empresa. Verifica el dígito verificador (ejemplo: 131-12345-7).';
      useCatalogue({ 'register.tax_id_invalid_for_company': rejection });
      const authService = TestBed.inject(AuthService) as unknown as {
        registerCheckout: jest.Mock;
      };
      authService.registerCheckout = jest
        .fn()
        .mockReturnValue(throwError(() => apiError(400, 'register.tax_id_invalid_for_company')));

      component.plan.patchValue({ agreeToTerms: true });
      component.onSubmit();

      expect(component.serverErrorMessage()).toBe(rejection);
      expect(component.errorMessage()).toBeNull();
    });

    it('falls back to its own sentence when the server gives no usable reason', () => {
      useCatalogue({ 'register.errors.unknown': 'No pudimos completar el registro.' });
      const authService = TestBed.inject(AuthService) as unknown as {
        registerCheckout: jest.Mock;
      };
      authService.registerCheckout = jest
        .fn()
        .mockReturnValue(throwError(() => apiError(500, 'errors.internal', {}, 'INTERNAL_ERROR')));

      component.plan.patchValue({ agreeToTerms: true });
      component.onSubmit();

      expect(component.serverErrorMessage()).toBe('No pudimos completar el registro.');
    });
  });

  /**
   * QA C-07: the account was created with the Terms box unticked, and the payload carried no
   * acceptance at all. Signup now waits for the box, and says why, and the payload carries the
   * acceptance with the editions on screen so the server can record and check them.
   */
  describe('consent to the Terms and the Privacy policy', () => {
    let authService: { registerCheckout: jest.Mock };

    beforeEach(() => {
      authService = TestBed.inject(AuthService) as unknown as { registerCheckout: jest.Mock };
      authService.registerCheckout = jest.fn().mockReturnValue(of({ url: null }));
    });

    it('does not submit while the box is unticked, and says why', () => {
      component.plan.patchValue({ agreeToTerms: false });

      component.onSubmit();

      expect(authService.registerCheckout).not.toHaveBeenCalled();
      expect(component.termsAccepted).toBe(false);
      expect(component.errorMessage()).toBe('register.errors.terms_required');
    });

    it('sends the acceptance and the editions in force once ticked', () => {
      component.plan.patchValue({ agreeToTerms: true });

      component.onSubmit();

      expect(authService.registerCheckout).toHaveBeenCalled();
      const payload = authService.registerCheckout.mock.calls[0][0];
      expect(payload.acceptTerms).toBe(true);
      expect(payload.termsVersion).toBe(LEGAL_DOCUMENTS.terms.version);
      expect(payload.privacyVersion).toBe(LEGAL_DOCUMENTS.privacy.version);
      // The old honeypot travelled as `fax`; the field is gone from the signup (QA A-12).
      expect(payload).not.toHaveProperty('fax');
    });
  });

  /** QA A-10: a phone that could not be verified must not block the signup or vanish silently. */
  describe('continuing without verifying the phone', () => {
    it('"verify later" keeps the number, unverified, and advances', () => {
      component.accountInfo.patchValue({ phone: '+12025550147' });
      component.currentStep.set(3);

      component.onPhoneSkipped('later');

      expect(component.currentStep()).toBe(4);
      expect(component.accountInfo.get('phone')?.value).toBe('+12025550147');
      expect(component.accountInfo.get('phoneCode')?.value).toBe('');
      expect(component.phoneVerified()).toBe(false);
    });

    it('"use email only" drops the number and advances', () => {
      component.accountInfo.patchValue({ phone: '+12025550147' });
      component.currentStep.set(3);

      component.onPhoneSkipped('email');

      expect(component.currentStep()).toBe(4);
      expect(component.accountInfo.get('phone')?.value).toBe('');
    });

    it('keeps the step as a gate while an entered number is neither verified nor skipped', () => {
      component.accountInfo.patchValue({ phone: '+12025550147' });
      component.currentStep.set(3);

      component.nextStep();

      expect(component.currentStep()).toBe(3);
      expect(component.phoneStepDone()).toBe(false);
    });
  });
});
