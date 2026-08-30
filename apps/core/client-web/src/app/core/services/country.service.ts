import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GeoLocationService } from './geo-location.service';

export interface AdministrativeDivision {
  code: string;
  name: string;
}

/**
 * One country's fiscal configuration, exactly as the backend publishes it.
 *
 * This used to be a hand-written remapping of whatever a backend strategy's `getConfig()` returned
 * — four different shapes across four strategies — with a `|| '.*'` on the tax-id pattern and a
 * catch-all fallback that also produced `'.*'`. That meant a network hiccup silently turned tax-id
 * validation off, and the user was told the value was fine right up until the server rejected it.
 *
 * The shape now mirrors `PublicCountryConfig` on the server, field for field. There is no defaulting
 * and no fallback object: if the country cannot be loaded, the form says so rather than pretending.
 */
export type TaxpayerKind = 'company' | 'individual';

/** One entry of a tax authority's published catalogue. */
export interface FiscalFieldOption {
  code: string;
  label: string;
  appliesTo?: TaxpayerKind[];
}

/**
 * A fiscal datum the country requires beyond name, tax id and address.
 *
 * Declared by the server and rendered generically here, so opening a market is a change to one
 * list on the backend rather than a new branch in this component.
 */
export interface FiscalFieldSpec {
  key: string;
  label: string;
  help?: string;
  required: boolean;
  type: 'select' | 'text';
  /** True when the authority admits several answers at once (Colombia's DIAN responsibilities). */
  multiple?: boolean;
  options?: FiscalFieldOption[];
  pattern?: string;
  example?: string;
  appliesTo?: TaxpayerKind[];
}

export interface CountryConfig {
  countryCode: string;
  name: string;
  currency: string;
  locale: string;
  phoneCode: string;
  fiscalAuthority: string;

  taxIdLabel: string;
  taxIdExample: string;
  taxIdPattern: string;
  taxIdHasCheckDigit: boolean;

  individualDocument: { code: string; label: string; pattern: string } | null;

  address: {
    divisionLabel: string;
    divisions?: AdministrativeDivision[];
    postalCodeLabel: string;
    postalCodePattern?: string;
    postalCodeRequired: boolean;
  };

  electronicInvoicing: { required: boolean; regime: string | null };

  /**
   * Whether the product can issue documents for this country's regime yet.
   *
   * `available` means a fiscal adapter exists. `preview` means the ERP works but that country's
   * e-invoicing is not implemented, and the signup form has to say so before payment instead of
   * promising a regime it cannot satisfy.
   */
  marketStatus: 'available' | 'preview';

  /** Whether the form must ask company versus natural person. */
  taxpayerKindRequired: boolean;

  /** The country's extra fiscal fields, rendered generically. */
  fiscalFields: FiscalFieldSpec[];

  dateFormat: string;
  thousandSeparator: string;
  decimalSeparator: string;

  fiscalRegionId: string;
}

export interface SupportedCountry {
  countryCode: string;
  name: string;
  currency: string;
  callingCode: string;
}

/** The result of resolving a tax id with the country's registry. */
export interface TaxIdLookupResult {
  countryCode: string;
  taxId: string;
  valid: boolean;
  found: boolean;
  legalName: string | null;
  status: string | null;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  USD: '$', DOP: 'RD$', MXN: '$', COP: '$', CLP: '$', PEN: 'S/', ARS: '$', BRL: 'R$',
  UYU: '$U', PYG: '₲', BOB: 'Bs', VES: 'Bs.', PAB: 'B/.', CRC: '₡', GTQ: 'Q', HNL: 'L', NIO: 'C$',
};

@Injectable({ providedIn: 'root' })
export class CountryService {
  private http = inject(HttpClient);
  private geoLocation = inject(GeoLocationService);

  /** The country currently selected, or null while it is loading or has failed to load. */
  readonly currentCountry = signal<CountryConfig | null>(null);

  /** True when the last attempt to load a country configuration failed. */
  readonly loadFailed = signal(false);

  readonly currentCountryCode = computed(
    () => this.currentCountry()?.countryCode.toLowerCase() ?? 'do',
  );

  readonly currencySymbol = computed(() => {
    const currency = this.currentCountry()?.currency;
    return currency ? (CURRENCY_SYMBOLS[currency] ?? currency) : '';
  });

  private configCache = new Map<string, Observable<CountryConfig>>();
  private supportedCountries$?: Observable<SupportedCountry[]>;

  /**
   * The countries a tenant can actually be registered in.
   *
   * Served from the backend, which reads the same list the provisioning does. The signup form used
   * to hardcode eight countries; two of them had no fiscal region, so choosing one produced a
   * tenant with no chart of accounts and no taxes, and said nothing about it.
   */
  getSupportedCountries(): Observable<SupportedCountry[]> {
    this.supportedCountries$ ??= this.http
      .get<SupportedCountry[]>(`${environment.apiUrl}/localization/countries`)
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.supportedCountries$;
  }

  /** Detect the visitor's country by IP and load its configuration; falls back to DO. */
  detectAndSetCountry(): void {
    this.geoLocation.getGeoLocation().subscribe({
      next: (res) => this.getCountryConfig(res?.country || 'DO').subscribe({ error: () => undefined }),
      error: () => this.getCountryConfig('DO').subscribe({ error: () => undefined }),
    });
  }

  /**
   * Load one country's configuration.
   *
   * Errors propagate. The previous implementation swallowed them and installed a fabricated config
   * whose tax-id pattern was `.*` and whose `fiscalRegionId` was undefined — so a failed request
   * left the form accepting any tax id and submitting a payload the server would reject. Callers
   * that need to survive a failure handle it explicitly; `loadFailed` lets the UI say what happened.
   */
  getCountryConfig(code: string): Observable<CountryConfig> {
    const normalized = (code ?? '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(normalized)) {
      const cached = this.currentCountry();
      return cached ? of(cached) : this.getCountryConfig('DO');
    }

    const current = this.currentCountry();
    if (current?.countryCode === normalized) {
      return of(current);
    }

    let request = this.configCache.get(normalized);
    if (!request) {
      request = this.http
        .get<CountryConfig>(`${environment.apiUrl}/localization/config/${normalized}`)
        .pipe(shareReplay({ bufferSize: 1, refCount: false }));
      this.configCache.set(normalized, request);
    }

    return request.pipe(
      tap({
        next: (config) => {
          this.currentCountry.set(config);
          this.loadFailed.set(false);
        },
        error: () => {
          // Do not install a fabricated configuration. A country whose rules could not be loaded
          // is a country the form must not let the user submit under.
          this.configCache.delete(normalized);
          this.loadFailed.set(true);
        },
      }),
    );
  }

  /**
   * Resolve a tax id with the country's registry, to pre-fill the legal name.
   *
   * Advisory only. `valid` is computed from the check digit and is what registration acts on;
   * `found` merely says whether a registry answered, and a registry being down must never stop
   * somebody from signing up.
   */
  lookupTaxId(taxId: string, countryCode: string): Observable<TaxIdLookupResult> {
    return this.http.get<TaxIdLookupResult>(
      `${environment.apiUrl}/localization/lookup/${encodeURIComponent(taxId)}?country=${encodeURIComponent(countryCode)}`,
    );
  }
}
