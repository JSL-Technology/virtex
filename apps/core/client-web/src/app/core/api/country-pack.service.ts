import { Injectable, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, distinctUntilChanged, of, switchMap } from 'rxjs';
import type { TenantCountryPackResponse } from '@virteex/shared/types';
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
}
