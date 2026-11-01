import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { LucideAngularModule, RefreshCw, ChevronDown, ChevronRight } from 'lucide-angular';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { composeKey } from '@virteex/shared/types';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { Warehouse, WarehousesService } from '../../masters/data/warehouses.service';
import {
  AiService,
  ForecastSeries,
  ForecastSummary,
  InventoryInsight,
  InventoryStatus,
  SupplierLeadTime,
  TopSeller,
} from '../data/ai.service';
import { ForecastChartComponent } from './forecast-chart.component';

/** How each status reads: a risk is a danger, a reorder a warning, excess and dead stock information. */
export const STATUS_TONE: Record<InventoryStatus, VxTone> = {
  STOCKOUT_RISK: 'danger',
  REORDER: 'warning',
  OVERSTOCK: 'info',
  DEAD_STOCK: 'neutral',
  OK: 'ok',
};

export const STATUSES: InventoryStatus[] = ['STOCKOUT_RISK', 'REORDER', 'OVERSTOCK', 'DEAD_STOCK', 'OK'];

/**
 * Demand predictions: what will sell, where, and what to do about the stock.
 *
 * Every number on this screen was computed by the forecasting engine from the stock ledger — none
 * by a language model — and the run that produced it is named in the header with its measured
 * accuracy, so a buyer can judge how far to trust it. Risks come first: a product about to run out
 * before a reorder could arrive is the row someone has to act on today.
 */
@Component({
  selector: 'app-ai-predictions-page',
  standalone: true,
  imports: [
    FormsModule,
    ...VX_FORM_A11Y,
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    ...FORMAT_PIPES,
    ListShellComponent,
    VxPagerComponent,
    VxBadgeComponent,
    HasPermissionDirective,
    ForecastChartComponent,
  ],
  templateUrl: './predictions.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './predictions.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PredictionsPage implements OnInit {
  private readonly ai = inject(AiService);
  private readonly warehousesApi = inject(WarehousesService);
  private readonly notifications = inject(NotificationService);

  protected readonly RunIcon = RefreshCw;
  protected readonly OpenIcon = ChevronDown;
  protected readonly ClosedIcon = ChevronRight;
  protected readonly STATUSES = STATUSES;
  /** A catalogue key whose leaf comes from data: `('x', 'STOCKOUT_RISK')` → `x.stockout_risk`. */
  protected readonly k = composeKey;
  protected readonly toneOf = (status: InventoryStatus) => STATUS_TONE[status];

  readonly rows = signal<InventoryInsight[]>([]);
  readonly summary = signal<ForecastSummary | null>(null);
  readonly topSellers = signal<TopSeller[]>([]);
  /** Measured lead time per supplier — what the reorder points are sized against. */
  readonly leadTimes = signal<SupplierLeadTime[]>([]);
  readonly warehouses = signal<Warehouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(50);
  readonly search = signal('');
  readonly statusFilter = signal<InventoryStatus | ''>('');
  readonly warehouseFilter = signal('');
  readonly sort = signal<'risk' | 'top_sellers'>('risk');
  readonly running = signal(false);

  readonly expanded = signal<string | null>(null);
  readonly series = signal<ForecastSeries | null>(null);
  readonly seriesLoading = signal(false);

  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);
  readonly neverRun = computed(() => !this.summary()?.lastSuccess);
  /** False when the analytics engine is stopped: a queued run will not move until it is back. */
  readonly engineOnline = signal(true);
  readonly runInProgress = computed(() => {
    const status = this.summary()?.lastRun?.status;
    return this.engineOnline() && (status === 'QUEUED' || status === 'RUNNING');
  });
  readonly medianWape = computed(() => {
    const value = this.summary()?.lastSuccess?.metrics?.['medianWape'];
    return typeof value === 'number' ? value : null;
  });

  /** The best sellers of each branch, grouped for the cards at the top. */
  readonly branches = computed(() => {
    const groups = new Map<string, { name: string; items: TopSeller[] }>();
    for (const row of this.topSellers()) {
      const key = row.branchId ?? 'none';
      const group = groups.get(key) ?? { name: row.branchName, items: [] };
      if (group.items.length < 5) group.items.push(row);
      groups.set(key, group);
    }
    return [...groups.values()];
  });

  ngOnInit(): void {
    this.warehousesApi.list().subscribe({
      next: (rows) => this.warehouses.set(rows),
      error: () => this.warehouses.set([]),
    });
    this.loadSummary();
    this.load();
    // Said rather than left on «Calculating…» forever (QA R3-M08).
    this.ai.status().subscribe({ next: (status) => this.engineOnline.set(status.engine?.online !== false), error: () => undefined });
  }

  loadSummary(): void {
    this.ai.forecastSummary().subscribe({
      next: (summary) => this.summary.set(summary),
      error: () => this.summary.set(null),
    });
    this.ai.topByBranch(5).subscribe({
      next: (rows) => this.topSellers.set(rows),
      error: () => this.topSellers.set([]),
    });
    this.ai.supplierLeadTimes().subscribe({
      next: (rows) => this.leadTimes.set(rows),
      error: () => this.leadTimes.set([]),
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.ai
      .insights({
        status: this.statusFilter(),
        warehouseId: this.warehouseFilter() || undefined,
        search: this.search() || undefined,
        sort: this.sort(),
        limit: this.limit(),
        offset: (this.page() - 1) * this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'ai.predictions.load_failed'));
          this.loading.set(false);
        },
      });
  }

  reload(): void {
    this.loadSummary();
    this.load();
  }

  onSearch(term: string): void {
    this.search.set(term);
    this.applyFilters();
  }

  filterStatus(status: InventoryStatus | ''): void {
    this.statusFilter.set(this.statusFilter() === status ? '' : status);
    this.applyFilters();
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  goToPage(page: number): void {
    this.page.set(page);
    this.load();
  }

  changePageSize(size: number): void {
    this.limit.set(size);
    this.applyFilters();
  }

  runNow(): void {
    this.running.set(true);
    this.ai.runForecast().subscribe({
      next: () => {
        this.running.set(false);
        this.notifications.showInfo('ai.predictions.run_queued');
        this.loadSummary();
      },
      error: (error: unknown) => {
        this.running.set(false);
        this.notifications.showHttpError(error, 'ai.predictions.run_failed');
      },
    });
  }

  rowKey(row: InventoryInsight): string {
    return `${row.productId}|${row.warehouseId}`;
  }

  toggle(row: InventoryInsight): void {
    const key = this.rowKey(row);
    if (this.expanded() === key) {
      this.expanded.set(null);
      return;
    }
    this.expanded.set(key);
    this.series.set(null);
    this.seriesLoading.set(true);
    this.ai.series(row.productId, row.warehouseId).subscribe({
      next: (series) => {
        if (this.expanded() === key) this.series.set(series);
        this.seriesLoading.set(false);
      },
      error: (error: unknown) => {
        this.seriesLoading.set(false);
        this.notifications.showHttpError(error, 'ai.predictions.series_failed');
      },
    });
  }
}
