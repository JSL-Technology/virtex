import { computed, signal } from '@angular/core';
import { of } from 'rxjs';
import { CountryConfig, SupportedCountry } from '../app/core/services/country.service';

/**
 * One test double for `CountryService`, shared by every spec that needs one.
 *
 * Four specs previously each invented their own `{ code, currencyCode, formSchema }` object. None
 * of those shapes matched what the backend actually returns, so the tests kept passing while the
 * real contract drifted — which is how the signup form ended up reading `formSchema.taxId.label`,
 * a field no endpoint has ever produced. A single double typed as `CountryConfig` makes that
 * class of drift a compile error instead of a silent one.
 */
export const DOMINICAN_CONFIG: CountryConfig = {
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
    divisions: [
      { code: '01', name: 'Distrito Nacional' },
      { code: '32', name: 'Santo Domingo' },
    ],
    postalCodeLabel: 'Código postal',
    postalCodePattern: '^\\d{5}$',
    postalCodeRequired: false,
  },
  electronicInvoicing: { required: true, regime: 'DGII e-CF' },
  dateFormat: 'dd/MM/yyyy',
  thousandSeparator: ',',
  decimalSeparator: '.',
  fiscalRegionId: '11111111-1111-4111-8111-111111111111',
};

export const US_CONFIG: CountryConfig = {
  countryCode: 'US',
  name: 'United States',
  currency: 'USD',
  locale: 'en-US',
  phoneCode: '+1',
  fiscalAuthority: 'IRS',
  taxIdLabel: 'EIN',
  taxIdExample: '12-3456789',
  taxIdPattern: '^\\d{2}-?\\d{7}$',
  taxIdHasCheckDigit: false,
  individualDocument: { code: 'SSN', label: 'SSN / ITIN', pattern: '^\\d{3}-?\\d{2}-?\\d{4}$' },
  address: {
    divisionLabel: 'State',
    divisions: [{ code: 'TX', name: 'Texas' }],
    postalCodeLabel: 'ZIP code',
    postalCodePattern: '^\\d{5}(-\\d{4})?$',
    postalCodeRequired: true,
  },
  electronicInvoicing: { required: false, regime: null },
  dateFormat: 'MM/dd/yyyy',
  thousandSeparator: ',',
  decimalSeparator: '.',
  fiscalRegionId: '22222222-2222-4222-8222-222222222222',
};

export const SUPPORTED_COUNTRIES: SupportedCountry[] = [
  { countryCode: 'DO', name: 'República Dominicana', currency: 'DOP', callingCode: '1' },
  { countryCode: 'US', name: 'United States', currency: 'USD', callingCode: '1' },
];

/**
 * The double exposes REAL signals, not `jest.fn()` stand-ins.
 *
 * `RegisterPage` reshapes its fiscal validators inside an `effect()`, and an effect only re-runs
 * when a signal it read changes. A plain mock function is not reactive, so a spec could switch
 * countries and observe nothing happening — the test would pass whether or not the component
 * responded. Signals here mean the specs exercise the same reactivity production does.
 */
export class MockCountryService {
  private readonly config = signal<CountryConfig | null>(DOMINICAN_CONFIG);

  readonly currentCountry = this.config.asReadonly();
  readonly currentCountryCode = computed(() =>
    (this.config()?.countryCode ?? 'DO').toLowerCase(),
  );
  readonly currencySymbol = computed(() => (this.config()?.currency === 'USD' ? '$' : 'RD$'));
  readonly loadFailed = signal(false);

  detectAndSetCountry = jest.fn();
  getSupportedCountries = jest.fn(() => of(SUPPORTED_COUNTRIES));
  getCountryConfig = jest.fn((code: string) => {
    const next = code.toUpperCase() === 'US' ? US_CONFIG : DOMINICAN_CONFIG;
    this.config.set(next);
    return of(next);
  });
  lookupTaxId = jest.fn(() =>
    of({ countryCode: 'DO', taxId: '', valid: true, found: false, legalName: null, status: null }),
  );

  /** Lets a spec drive the component through a country change. */
  setConfig(config: CountryConfig | null) {
    this.config.set(config);
  }
}
