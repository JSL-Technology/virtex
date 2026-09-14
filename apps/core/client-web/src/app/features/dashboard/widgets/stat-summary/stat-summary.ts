import { ChangeDetectionStrategy, Component, Input, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, DollarSign, Receipt, Package, Users, BarChart3, TrendingDown, TrendingUp } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { catchError, of, shareReplay } from 'rxjs';
import { DashboardApiService, DashboardSummary } from '../../../../core/api/dashboard-api.service';
import { FormatService } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';

/** Which of the four headline figures this instance shows. */
export type SummaryStat = 'sales-today' | 'pending-invoices' | 'low-stock' | 'active-customers';

/**
 * One of the dashboard's four headline figures, from the tenant's own data.
 *
 * ## What this replaces
 *
 * Four `stat-card` widgets whose values were literals in the widget catalogue — "Ventas de Hoy
 * $1,250.00 +15%", "Facturas Pendientes 12 −5%", "Productos Bajos 8 +2", "Clientes Activos 312
 * +1.2%". They were the same for every tenant, the percentages were measured against nothing, and
 * the titles were Spanish strings compiled into the bundle.
 *
 * One request serves all four instances: the observable is shared, so four cards on a page make
 * one round trip.
 */
@Component({
  selector: 'app-stat-summary',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './stat-summary.html',
  styleUrls: ['./stat-summary.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatSummary {
  private readonly api = inject(DashboardApiService);
  private readonly format = inject(FormatService);

  @Input({ required: true }) stat!: SummaryStat;

  protected readonly TrendingUpIcon = TrendingUp;
  protected readonly TrendingDownIcon = TrendingDown;

  private readonly summary = toSignal(
    this.api.getSummary().pipe(
      catchError(() => of(null)),
      shareReplay({ bufferSize: 1, refCount: false }),
    ),
    { initialValue: null },
  );

  readonly ready = computed(() => this.summary() !== null);

  readonly icon = computed(() => {
    switch (this.stat) {
      case 'sales-today': return DollarSign;
      case 'pending-invoices': return Receipt;
      case 'low-stock': return Package;
      case 'active-customers': return Users;
      default: return BarChart3;
    }
  });

  readonly titleKey = computed(() => composeKey('dashboard.summary', keyOf(this.stat), 'title'));

  readonly value = computed(() => {
    const summary = this.summary();
    if (!summary) return '';
    switch (this.stat) {
      case 'sales-today': return this.format.money(summary.salesToday);
      case 'pending-invoices': return this.format.number(summary.pendingInvoices, '1.0-0');
      case 'low-stock': return this.format.number(summary.lowStockProducts, '1.0-0');
      case 'active-customers': return this.format.number(summary.activeCustomers, '1.0-0');
      default: return '';
    }
  });

  /** The secondary line: what the headline figure is worth, or how bad the shortage is. */
  readonly subtitle = computed(() => {
    const summary = this.summary();
    if (!summary) return null;
    switch (this.stat) {
      case 'pending-invoices':
        return this.format.money(summary.pendingInvoicesAmount);
      case 'low-stock':
        return summary.outOfStockProducts > 0
          ? { key: 'dashboard.summary.low_stock.out_of_stock', params: { count: summary.outOfStockProducts } }
          : null;
      default:
        return null;
    }
  });

  /** Null when there is nothing to compare against — never "+100 %" on a first day of trading. */
  readonly change = computed<number | null>(() => {
    const summary = this.summary();
    if (!summary) return null;
    switch (this.stat) {
      case 'sales-today': return summary.salesTodayChange;
      case 'active-customers': return summary.activeCustomersChange;
      default: return null;
    }
  });

  readonly changeText = computed(() => {
    const change = this.change();
    return change === null ? null : this.format.percent(change);
  });

  /**
   * Whether the movement reads as good.
   *
   * Direction is not the same as sentiment everywhere — more overdue invoices is not an
   * improvement — but the two figures that carry a change here (revenue, customers) are both
   * better when they rise.
   */
  readonly isPositive = computed(() => (this.change() ?? 0) >= 0);
}

function keyOf(stat: SummaryStat): string {
  return stat.toUpperCase().replace(/-/g, '_');
}
