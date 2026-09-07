import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, of } from 'rxjs';
import { environment } from '../../../environments/environment';

export type PeriodStatus = 'OPEN' | 'CLOSED' | string;

export interface CurrentPeriod {
  id: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
}

/**
 * The state of the world the status bar reports.
 *
 * Fetched once when the shell mounts and refreshed when something that could change it happens —
 * closing a period, switching company — rather than polled. A status bar that polls is a status bar
 * that costs a request per user per interval for a fact that changes monthly.
 */
@Injectable({ providedIn: 'root' })
export class StatusBarService {
  private readonly http = inject(HttpClient);

  private readonly _period = signal<CurrentPeriod | null>(null);
  private readonly _loaded = signal(false);

  readonly period = this._period.asReadonly();
  readonly loaded = this._loaded.asReadonly();

  refresh(): void {
    this.http
      .get<{ period: CurrentPeriod | null }>(`${environment.apiUrl}/accounting/current-period`)
      // A tenant without permission to see accounting, or without a calendar yet, is a normal
      // state — not a reason to show an error in a bar that is meant to reassure.
      .pipe(catchError(() => of({ period: null })))
      .subscribe((response) => {
        this._period.set(response.period);
        this._loaded.set(true);
      });
  }
}
