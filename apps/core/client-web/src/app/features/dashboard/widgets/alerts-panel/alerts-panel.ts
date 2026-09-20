import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { catchError, of } from 'rxjs';
import { DashboardAlert, DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { VxEmptyStateComponent } from '../../../../shared/components/feedback';

/**
 * What needs attention, derived from the tenant's own data.
 *
 * ## What this was
 *
 * Two hardcoded warnings: that the gross margin on "Laptop Pro" had fallen 15 %, and that
 * "Ejemplo Corp" had invoices in arrears. Every customer of the product saw both, for ever,
 * regardless of what they sold or who owed them money — and in Spanish, whatever language they had
 * chosen. An alert that is always on is not an alert.
 *
 * The three it reports now are facts the data can state: money that should already have arrived,
 * stock that has run out, and a period still open after it ended. The server sends the fact and an
 * i18n key; the sentence is written here, in the reader's language.
 */
@Component({
  selector: 'app-alerts-panel',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, VxEmptyStateComponent],
  templateUrl: './alerts-panel.html',
  styleUrls: ['../widget-styles.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlertsPanel {
  private readonly dashboardApi = inject(DashboardApiService);

  protected readonly WarningIcon = AlertTriangle;
  protected readonly CriticalIcon = AlertCircle;
  protected readonly CheckIcon = CheckCircle;

  readonly alerts = toSignal(
    this.dashboardApi.getAlerts().pipe(catchError(() => of([] as DashboardAlert[]))),
    { initialValue: [] as DashboardAlert[] },
  );
}
