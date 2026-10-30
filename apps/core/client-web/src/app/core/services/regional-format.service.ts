import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, tap } from 'rxjs';
import { LocaleStore } from '@virteex/shared/ui-i18n';
import { RegionalFormat, normaliseRegionalFormat } from '@virteex/shared/types';
import { environment } from '../../../environments/environment';
import { UsersService } from '../../features/settings/data/users.service';

/**
 * Saves how dates, numbers and times are written — the company's default and a person's own.
 *
 * Each save is applied to `LocaleStore` as soon as the server accepts it, so every figure and date
 * on the screen changes at once; the next session refresh brings the same values back from the
 * server. Nothing is applied before the server agrees: a format that failed to save must not look
 * saved.
 */
@Injectable({ providedIn: 'root' })
export class RegionalFormatService {
  private readonly http = inject(HttpClient);
  private readonly users = inject(UsersService);
  private readonly store = inject(LocaleStore);
  private readonly url = `${environment.apiUrl}/organizations/regional-format`;

  /** The company's default, as the server holds it. */
  company(): Observable<RegionalFormat> {
    return this.http.get<RegionalFormat>(this.url).pipe(map(normaliseRegionalFormat));
  }

  /** Replaces the company's default for everyone. A field left out returns to automatic. */
  saveCompany(format: RegionalFormat): Observable<RegionalFormat> {
    const clean = normaliseRegionalFormat(format);
    return this.http.put<RegionalFormat>(this.url, clean).pipe(
      map(normaliseRegionalFormat),
      tap((saved) => this.store.setCompanyFormat(saved)),
    );
  }

  /** Replaces this person's own format. `{}` follows the company in everything. */
  savePersonal(format: RegionalFormat): Observable<RegionalFormat> {
    const clean = normaliseRegionalFormat(format);
    const body = Object.keys(clean).length ? clean : null;
    return this.users.updateProfile({ regionalFormat: body }).pipe(
      map(() => clean),
      tap((saved) => this.store.setPersonalFormat(saved)),
    );
  }
}
