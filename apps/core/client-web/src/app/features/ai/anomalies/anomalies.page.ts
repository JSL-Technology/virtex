import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, RefreshCw, Sparkles, ThumbsUp, ThumbsDown, RotateCcw } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { composeKey } from '@virteex/shared/types';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxPagerComponent } from '../../../shared/components/pager';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { NotificationService } from '../../../core/services/notification';
import { AiService, Anomaly, AnomalySeverity, AnomalyStatus, EngineRun } from '../data/ai.service';

export const SEVERITY_TONE: Record<AnomalySeverity, VxTone> = {
  CRITICAL: 'danger',
  HIGH: 'danger',
  MEDIUM: 'warning',
  LOW: 'info',
};

/** Evidence fields worth showing, per detector, in the order a reviewer reads them. */
const EVIDENCE_FIELDS: Record<string, string[]> = {
  'rule.duplicate_vendor_bill': ['fiscalNumber', 'total', 'count', 'reason'],
  'rule.sale_below_cost': ['invoiceNumber', 'revenue', 'cost', 'loss', 'margin'],
  'rule.pos_cancellations': ['tickets', 'cancelled', 'cancelledTotal', 'rate', 'typicalRate'],
  'rule.large_inventory_adjustment': ['quantity', 'unitCost', 'value', 'typicalValue', 'direction'],
  'timeseries.branch_sales': ['amount', 'expected', 'direction', 'robustZ'],
  'outlier.invoice': ['invoiceNumber', 'total', 'discountRatio', 'hour', 'lines', 'percentile'],
  'forensic.benford': ['bills', 'mad', 'threshold', 'pValue'],
  'rule.duplicate_customer_payment': ['reference', 'amount', 'count', 'reason'],
  'rule.vendor_overpayment': ['reason', 'billTotal', 'settled', 'excess', 'payments'],
  'rule.three_way_match': ['orderNumber', 'reason', 'valueNotReceived', 'orderTotal', 'billedTotal', 'excess'],
  'rule.returns_spike': ['dispatched', 'returned', 'returnRate', 'previousRate', 'tenantRate'],
  'rule.price_change': ['productName', 'reasons', 'oldPrice', 'newPrice', 'oldCost', 'newCost', 'localHour', 'offHours'],
  'rule.invoiced_price': ['invoiceNumber', 'price', 'typicalPrice', 'direction', 'comparedWith'],
  'rule.discount': ['invoiceNumber', 'discount', 'discountRatio', 'typicalRatio'],
  'rule.post_issue_change': ['action', 'statusBefore', 'fields'],
  'rule.off_hours': ['actions', 'hours', 'shareOfActivityAtThoseHours', 'timezone'],
};

/** Evidence whose values are codes, shown through `ai.anomalies.value.*` rather than as written. */
const TRANSLATED_VALUES = new Set(['direction', 'reason', 'reasons', 'action', 'offHours']);

/**
 * The anomaly inbox: what the engine found unusual in sales, purchases, stock and cash.
 *
 * A finding is evidence for a person, not a verdict. Each one shows what was found and the numbers
 * behind it; a plain-language explanation can be asked for (it is written from that evidence, and
 * costs a credit, so it is on demand); and the person's decision — useful, or a false positive — is
 * what teaches the engine which detectors this company wants to hear from.
 */
@Component({
  selector: 'app-ai-anomalies-page',
  standalone: true,
  imports: [FormsModule, ...VX_FORM_A11Y, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ListShellComponent, VxPagerComponent, VxBadgeComponent, HasPermissionDirective],
  templateUrl: './anomalies.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './anomalies.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnomaliesPage implements OnInit {
  private readonly ai = inject(AiService);
  private readonly notifications = inject(NotificationService);

  protected readonly RunIcon = RefreshCw;
  protected readonly ExplainIcon = Sparkles;
  protected readonly UsefulIcon = ThumbsUp;
  protected readonly DismissIcon = ThumbsDown;
  protected readonly ReopenIcon = RotateCcw;
  protected readonly SEVERITIES: AnomalySeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  protected readonly STATUSES: AnomalyStatus[] = ['OPEN', 'CONFIRMED', 'DISMISSED'];
  protected readonly CATEGORIES = ['sales', 'purchases', 'inventory', 'cash', 'security'];
  /** A catalogue key whose leaf comes from data: `('x', 'STOCKOUT_RISK')` → `x.stockout_risk`. */
  protected readonly k = composeKey;
  protected readonly toneOf = (severity: AnomalySeverity) => SEVERITY_TONE[severity];

  private readonly aiStatus = toSignal(this.ai.status().pipe(catchError(() => of(null))), { initialValue: null });
  readonly canExplain = computed(() => !!this.aiStatus()?.anomalies.explanations);

  readonly rows = signal<Anomaly[]>([]);
  readonly byStatus = signal<Partial<Record<AnomalyStatus, number>>>({});
  readonly lastRun = signal<EngineRun | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly limit = signal(25);
  readonly statusFilter = signal<AnomalyStatus | ''>('OPEN');
  readonly severityFilter = signal<AnomalySeverity | ''>('');
  readonly categoryFilter = signal('');
  readonly busy = signal<string | null>(null);
  readonly running = signal(false);

  readonly empty = computed(() => !this.loading() && !this.error() && this.rows().length === 0);

  ngOnInit(): void {
    this.loadRun();
    this.load();
  }

  loadRun(): void {
    this.ai.lastAnomalyRun().subscribe({
      next: (run) => this.lastRun.set(run),
      error: () => this.lastRun.set(null),
    });
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.ai
      .anomalies({
        status: this.statusFilter(),
        severity: this.severityFilter(),
        category: this.categoryFilter() || undefined,
        limit: this.limit(),
        offset: (this.page() - 1) * this.limit(),
      })
      .subscribe({
        next: (result) => {
          this.rows.set(result.items);
          this.total.set(result.total);
          this.byStatus.set(result.byStatus);
          this.loading.set(false);
        },
        error: (error: unknown) => {
          this.error.set(this.notifications.httpErrorMessage(error, 'ai.anomalies.load_failed'));
          this.loading.set(false);
        },
      });
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

  evidenceOf(anomaly: Anomaly): Array<{ key: string; value: unknown }> {
    const fields = EVIDENCE_FIELDS[anomaly.detector] ?? Object.keys(anomaly.evidence).slice(0, 6);
    return fields
      .filter((key) => anomaly.evidence[key] !== undefined && anomaly.evidence[key] !== null)
      .map((key) => ({ key, value: anomaly.evidence[key] }));
  }

  isNumber(value: unknown): value is number {
    return typeof value === 'number';
  }

  isTranslated(key: string): boolean {
    return TRANSLATED_VALUES.has(key);
  }

  /** A scalar or a list, as the list of values to show. */
  asList(value: unknown): string[] {
    return (Array.isArray(value) ? value : [value]).map((v) => String(v));
  }

  runNow(): void {
    this.running.set(true);
    this.ai.runAnomalies().subscribe({
      next: () => {
        this.running.set(false);
        this.notifications.showInfo('ai.anomalies.run_queued');
        this.loadRun();
      },
      error: (error: unknown) => {
        this.running.set(false);
        this.notifications.showHttpError(error, 'ai.anomalies.run_failed');
      },
    });
  }

  verdict(anomaly: Anomaly, verdict: 'USEFUL' | 'FALSE_POSITIVE'): void {
    this.busy.set(anomaly.id);
    this.ai.feedback(anomaly.id, verdict).subscribe({
      next: () => {
        this.busy.set(null);
        this.notifications.showSuccess(verdict === 'USEFUL' ? 'ai.anomalies.confirmed' : 'ai.anomalies.dismissed');
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.notifications.showHttpError(error, 'ai.anomalies.feedback_failed');
      },
    });
  }

  reopen(anomaly: Anomaly): void {
    this.busy.set(anomaly.id);
    this.ai.reopen(anomaly.id).subscribe({
      next: () => {
        this.busy.set(null);
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.notifications.showHttpError(error, 'ai.anomalies.feedback_failed');
      },
    });
  }

  explain(anomaly: Anomaly): void {
    this.busy.set(anomaly.id);
    this.ai.explain(anomaly.id).subscribe({
      next: (updated) => {
        this.busy.set(null);
        this.rows.update((rows) => rows.map((row) => (row.id === updated.id ? { ...row, explanation: updated.explanation } : row)));
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.notifications.showHttpError(error, 'ai.anomalies.explain_failed');
      },
    });
  }
}
