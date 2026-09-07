import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { TranslateModule, TranslateLoader } from '@ngx-translate/core';
import { Observable } from 'rxjs';

import { RegisterPage } from './register.page';
import { AuthService } from '../../../core/services/auth';
import { ReCaptchaV3Service } from 'ng-recaptcha-19';
import { CountryService, CountryConfig } from '../../../core/services/country.service';
import { LanguageService } from '../../../core/services/language';
import { GeoLocationService } from '../../../core/services/geo-location.service';
import { ConfigService } from '../../../shared/services/config.service';
import { UsersService } from '../../../core/api/users.service';
import { signal, computed } from '@angular/core';

// A DO config that mirrors PRODUCTION: the DGII income type is a required select.
const DO_WITH_FISCAL: CountryConfig = {
  countryCode: 'DO',
  name: 'República Dominicana',
  currency: 'DOP',
  locale: 'es-DO',
  phoneCode: '+1',
  fiscalAuthority: 'DGII',
  taxIdLabel: 'RNC / Cédula',
  taxIdExample: '131-12345-7',
  taxIdPattern: '^\\d{3}-?\\d{5}-?\\d$|^\\d{11}$',
  taxIdHasCheckDigit: true,
  individualDocument: { code: 'CEDULA', label: 'Cédula', pattern: '^\\d{11}$' },
  address: {
    divisionLabel: 'Provincia',
    divisions: [{ code: '01', name: 'Distrito Nacional' }],
    postalCodeLabel: 'Código postal',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: false,
  },
  electronicInvoicing: { required: true, regime: 'DGII e-CF' },
  marketStatus: 'available',
  taxpayerKindRequired: true,
  fiscalFields: [
    {
      key: 'tipoIngreso',
      label: 'Tipo de ingreso',
      required: true,
      type: 'select',
      options: [{ code: '01', label: 'Ingresos por operaciones' }],
    },
  ],
  dateFormat: 'dd/MM/yyyy',
  thousandSeparator: ',',
  decimalSeparator: '.',
  fiscalRegionId: '11111111-1111-4111-8111-111111111111',
};

class FakeLoader implements TranslateLoader {
  getTranslation(): Observable<any> {
    return of({});
  }
}
class MockAuthService {
  getSocialRegisterInfo = jest.fn().mockReturnValue(of({}));
  registerCheckout = jest.fn().mockReturnValue(of({ url: null }));
}
class MockRecaptcha {
  execute = jest.fn().mockReturnValue(of('tok'));
}
class MockLanguage {
  currentLang = jest.fn().mockReturnValue('es');
  currentLanguage = jest.fn().mockReturnValue('es');
}
class MockGeo {
  getGeoLocation = jest.fn().mockReturnValue(of({ country: 'DO' }));
  checkAndNotifyMismatch = jest.fn();
}
class MockConfig {
  getRegistrationOptions = jest.fn().mockReturnValue(of({ industries: [], companySizes: [] }));
}
class MockUsers {
  updateUser = jest.fn().mockReturnValue(of({}));
}

// Country service that has ALREADY loaded the DO config before the component is created —
// exactly what CountryGuard does before activating /es/do/auth/register.
class PreloadedCountryService {
  private cfg = signal<CountryConfig | null>(DO_WITH_FISCAL);
  readonly currentCountry = this.cfg.asReadonly();
  readonly currentCountryCode = computed(() => (this.cfg()?.countryCode ?? 'DO').toLowerCase());
  readonly currencySymbol = computed(() => 'RD$');
  readonly loadFailed = signal(false);
  detectAndSetCountry = jest.fn();
  getSupportedCountries = jest.fn(() =>
    of([{ countryCode: 'DO', name: 'RD', currency: 'DOP', callingCode: '1' }]),
  );
  getCountryConfig = jest.fn(() => of(DO_WITH_FISCAL));
  lookupTaxId = jest.fn(() => of({ countryCode: 'DO', taxId: '', valid: true, found: false, legalName: null, status: null }));
  setConfig(c: CountryConfig | null) { this.cfg.set(c); }
}

describe('RegisterPage — DO fiscal field (production-shaped config)', () => {
  let component: RegisterPage;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterPage, NoopAnimationsModule, TranslateModule.forRoot({ loader: { provide: TranslateLoader, useClass: FakeLoader } })],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useClass: MockAuthService },
        { provide: ReCaptchaV3Service, useClass: MockRecaptcha },
        { provide: CountryService, useClass: PreloadedCountryService },
        { provide: LanguageService, useClass: MockLanguage },
        { provide: GeoLocationService, useClass: MockGeo },
        { provide: ConfigService, useClass: MockConfig },
        { provide: UsersService, useClass: MockUsers },
      ],
    });
    TestBed.overrideComponent(RegisterPage, {
      add: { providers: [{ provide: ReCaptchaV3Service, useClass: MockRecaptcha }] },
    });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(RegisterPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the tipoIngreso control from the country config', () => {
    const control = component.configuration.get('fiscalProfile.tipoIngreso');
    // If this is null, the form never asked for the income type the backend requires.
    expect(control).not.toBeNull();
  });

  it('is invalid (and therefore blocks step 4) while tipoIngreso is empty', () => {
    component.configuration.patchValue({
      taxId: '131-12345-7',
      address: 'Av. Churchill 1099',
      city: 'Santo Domingo',
      state: '01',
    });
    // The whole point of the fiscal gate: an empty required income type must keep the step invalid.
    expect(component.configuration.valid).toBe(false);
  });

  it('renders the tipoIngreso <select> at step 4 and binds a chosen value into the form', () => {
    const fixture = TestBed.createComponent(RegisterPage);
    const cmp = fixture.componentInstance;
    fixture.detectChanges();

    // Navigate to the fiscal step and render it.
    cmp.currentStep.set(4);
    fixture.detectChanges();

    const select: HTMLSelectElement | null = fixture.nativeElement.querySelector('#fiscal-tipoIngreso');
    // If this is null, the field the backend requires is not on screen — the user cannot fill it.
    expect(select).not.toBeNull();

    // Simulate the user choosing "01". A single-select must store the code as a STRING; if the
    // multiple-select accessor is wired by mistake the value comes back as ['01'] and the server
    // rejects it as an empty income type.
    select!.value = '01';
    select!.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(cmp.configuration.get('fiscalProfile.tipoIngreso')?.value).toBe('01');
  });

  it('sends tipoIngreso in the register-checkout payload once chosen', () => {
    component.configuration.patchValue({
      taxId: '131-12345-7',
      address: 'Av. Churchill 1099',
      city: 'Santo Domingo',
      state: '01',
      fiscalProfile: { tipoIngreso: '01' },
    });
    component.business.patchValue({ companyName: 'Acme', industry: 'tech' });
    component.accountInfo.patchValue({ firstName: 'A', lastName: 'B', email: 'a@b.com' });

    component.onSubmit();

    const auth = TestBed.inject(AuthService) as unknown as { registerCheckout: jest.Mock };
    expect(auth.registerCheckout).toHaveBeenCalled();
    const payload = auth.registerCheckout.mock.calls[0][0];
    expect(payload.fiscalProfile).toEqual({ tipoIngreso: '01' });
  });
});
