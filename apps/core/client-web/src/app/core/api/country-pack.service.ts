import { Injectable, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, of, switchMap } from 'rxjs';
import type { CountryPackFiscalField, TenantCountryPackResponse } from '@virteex/shared/types';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { environment } from '../../../environments/environment';

/**
 * What the company's market has, for every screen that used to assume the Dominican Republic.
 *
 * ## Why one store and not a check per screen
 *
 * QA C-06: a US company was shown «Withholding at source», a «Designated withholding agent», the
 * DGII payment-method codes and a «Consumidor final». Each screen had been written for the first
 * market, and the fix is not to teach each of them about the second one with an
 * `if (country === 'DO')` — that is how the next market gets the Dominican product again. The server
 * declares each market's capabilities once (its country pack) and every screen reads them here.
 *
 * Fetched once per company country and shared: switching company refetches, opening ten invoice
 * tabs does not. Until it arrives screens treat it as «not known yet» and show only what
 * every market has, so a field never flashes in and back out for a market that lacks it.
 */
@Injectable({ providedIn: 'root' })
export class CountryPackService {
  private readonly http = inject(HttpClient);
  private readonly locale = inject(LocaleStore);

  /** The company's country; '' for a company with none (it gets the neutral pack), null before a session. */
  private readonly country = computed(() => {
    const context = this.locale.tenantContext();
    return context ? (context.countryCode ?? '').toUpperCase() : null;
  });

  /** The pack; `undefined` while it loads, `null` when it could not be read. */
  readonly pack = toSignal(
    toObservable(this.country).pipe(
      distinctUntilChanged(),
      switchMap((country) =>
        country === null
          ? of(undefined)
          : this.http
              .get<TenantCountryPackResponse>(`${environment.apiUrl}/localization/country-pack`)
              .pipe(catchError(() => of(null))),
      ),
    ),
    { initialValue: undefined as TenantCountryPackResponse | null | undefined },
  );

  /** Withholding at source exists in the market (false while unknown). */
  readonly withholding = computed(() => this.pack()?.withholding.applies ?? false);
  /** Sales documents carry an authority number (false while unknown). */
  readonly fiscalNumbering = computed(() => this.pack()?.documents.fiscalNumbering ?? false);
  /**
   * What the market's authority asks about a purchase, beyond its figures and its document: each
   * field with its label, whether it is required and the only codes it accepts. Empty while the pack
   * loads and in a market that asks for nothing — the form shows no such section either way.
   *
   * The screens used to hold one authority's code tables in their own source, so every market was
   * offered the Dominican 606's classification and nothing else could be asked for at all.
   */
  readonly purchaseFiscalFields = computed<readonly CountryPackFiscalField[]>(
    () => this.pack()?.purchases.fiscalAttributes ?? [],
  );

  /**
   * What this market's electronic-invoicing regime is and what it asks of the company.
   *
   * The settings screen used to carry the list itself, keyed by country code — `EC: [...]`,
   * `BR: [...]` — and a `=== 'DO'` branch in its template, so a market the product gained asked for
   * nothing until the client was edited too.
   */
  readonly einvoicingRegime = computed(() => this.pack()?.einvoicing ?? null);
}
