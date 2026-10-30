import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, RefreshCw, Sparkles, FlaskConical } from 'lucide-angular';
import { Subscription, timer } from 'rxjs';
import { FORMAT_PIPES, VxNumberInputDirective } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { composeKey } from '@virteex/shared/types';
import { NotificationService } from '../../../core/services/notification';
import { CashflowChartComponent } from './cashflow-chart.component';
import {
  AiReport,
  CashflowDocument,
  CashflowOverview,
  CashflowScenarioInput,
  CashflowScenarioResult,
  CashflowService,
} from './cashflow.service';

const POLL_MS = 5000;
const pending = (status: string | undefined | null) => status === 'QUEUED' || status === 'RUNNING';

/**
 * Treasury › Projected cash flow.
 *
 * The balance the company is heading to over the next weeks, as a band of the likely, from the
 * nightly simulation (open invoices on both sides, how this company's customers and the company
 * itself really pay, the sales and spending not yet invoiced, payroll). With the documents that
 * decide it, a cash plan written from those figures on request, and what-if scenarios beside the
 * projection — never over it.
 */
@Component({
  selector: 'app-cashflow-page',
  standalone: true,
  imports: [VxNumberInputDirective, FormsModule, KeyValuePipe, TranslatePipe, LucideAngularModule, ...FORMAT_PIPES, ...VX_FORM_A11Y, CashflowChartComponent],
  templateUrl: './cashflow.page.html',
  styleUrl: './cashflow.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CashflowPage implements OnInit {
  private readonly api = inject(CashflowService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly RefreshIcon = RefreshCw;
  protected readonly PlanIcon = Sparkles;
  protected readonly ScenarioIcon = FlaskConical;
  protected readonly k = composeKey;

  readonly overview = signal<CashflowOverview | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly refreshing = signal(false);

  readonly docKind = signal<'RECEIVABLE' | 'PAYABLE'>('RECEIVABLE');
  readonly docSort = signal<'risk' | 'amount' | 'expected'>('risk');
  readonly documents = signal<CashflowDocument[]>([]);
  readonly documentsTotal = signal(0);

  readonly plan = signal<AiReport | null>(null);

  readonly scenarioInput = signal<CashflowScenarioInput>({ salesChange: 0, collectionDelayDays: 0, extraMonthlyExpense: 0, oneOffAmount: 0, oneOffDay: 0 });
  readonly scenarioResult = signal<CashflowScenarioResult | null>(null);
  readonly scenarioRunning = signal(false);
  /** The scenario against the projection, in words; asked for once the scenario has run. */
  readonly scenarioNarrative = signal<AiReport | null>(null);

  readonly projection = computed(() => this.overview()?.projection ?? null);
  readonly metrics = computed(() => this.projection()?.metrics ?? null);
  readonly currency = computed(() => this.projection()?.baseCurrency ?? null);
  readonly runInProgress = computed(() => pending(this.overview()?.latest?.status));
  readonly risk = computed<'high' | 'medium' | 'low'>(() => {
    const p = this.metrics()?.shortfallProbability ?? 0;
    return p >= 0.3 ? 'high' : p >= 0.1 ? 'medium' : 'low';
  });
  readonly scenarioMetrics = computed(() => this.scenarioResult()?.scenario?.metrics ?? null);

  private polling: Subscription | null = null;

  ngOnInit(): void {
    this.load();
    this.loadPlan();
    this.destroyRef.onDestroy(() => this.polling?.unsubscribe());
  }

  load(): void {
    this.api.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.loading.set(false);
        this.error.set(null);
        if (overview.projection) this.loadDocuments();
        this.schedulePoll();
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(err, 'ai.cashflow.load_failed'));
      },
    });
  }

  refresh(): void {
    this.refreshing.set(true);
    this.api.refresh(this.metrics()?.threshold ?? 0).subscribe({
      next: (run) => {
        this.refreshing.set(false);
        this.overview.update((overview) => ({ latest: run, projection: overview?.projection ?? null }));
        this.schedulePoll();
      },
      error: (err) => {
        this.refreshing.set(false);
        this.notifications.showHttpError(err, 'ai.cashflow.refresh_failed');
      },
    });
  }

  setDocKind(kind: 'RECEIVABLE' | 'PAYABLE'): void {
    this.docKind.set(kind);
    this.loadDocuments();
  }

  setDocSort(sort: 'risk' | 'amount' | 'expected'): void {
    this.docSort.set(sort);
    this.loadDocuments();
  }

  loadDocuments(): void {
    this.api.documents(this.docKind(), this.docSort(), 25).subscribe({
      next: (page) => {
        this.documents.set(page.items);
        this.documentsTotal.set(page.total);
      },
      error: () => this.documents.set([]),
    });
  }

  requestPlan(): void {
    this.api.requestPlan().subscribe({
      next: (report) => {
        this.plan.set(report);
        this.schedulePoll();
      },
      error: (err) => this.notifications.showHttpError(err, 'ai.cashflow.plan_failed'),
    });
  }

  updateScenario(field: keyof CashflowScenarioInput, value: number | string): void {
    const number = Number(value);
    this.scenarioInput.update((input) => ({ ...input, [field]: Number.isFinite(number) ? number : 0 }));
  }

  runScenario(): void {
    const input = this.scenarioInput();
    // The form asks for a percentage; the API takes a fraction.
    const payload: CashflowScenarioInput = { ...input, salesChange: (input.salesChange ?? 0) / 100 };
    this.scenarioRunning.set(true);
    this.api.runScenario(payload, this.metrics()?.threshold ?? 0).subscribe({
      next: (run) => {
        this.scenarioResult.set({ run, scenario: null, baseline: this.projection() });
        this.scenarioNarrative.set(null);
        this.schedulePoll();
      },
      error: (err) => {
        this.scenarioRunning.set(false);
        this.notifications.showHttpError(err, 'ai.cashflow.scenario_failed');
      },
    });
  }

  explainScenario(): void {
    const run = this.scenarioResult()?.run;
    if (!run || run.status !== 'SUCCEEDED') return;
    this.api.requestScenarioNarrative(run.id).subscribe({
      next: (report) => {
        this.scenarioNarrative.set(report);
        this.schedulePoll();
      },
      error: (err) => this.notifications.showHttpError(err, 'ai.cashflow.scenario.explain_failed'),
    });
  }

  delta(scenario: number | undefined, baseline: number | undefined): number | null {
    return scenario === undefined || baseline === undefined ? null : scenario - baseline;
  }

  private loadPlan(): void {
    this.api.plan().subscribe({
      next: (report) => {
        this.plan.set(report);
        this.schedulePoll();
      },
      error: () => this.plan.set(null),
    });
  }

  /** While anything is being computed or written, look again every few seconds; stop when done. */
  private schedulePoll(): void {
    const waiting =
      this.runInProgress() ||
      pending(this.plan()?.status) ||
      pending(this.scenarioResult()?.run.status) ||
      pending(this.scenarioNarrative()?.status);
    this.polling?.unsubscribe();
    if (!waiting) return;
    this.polling = timer(POLL_MS).subscribe(() => {
      if (this.runInProgress()) this.load();
      if (pending(this.plan()?.status)) this.loadPlan();
      const narrative = this.scenarioNarrative();
      const scenarioRun = this.scenarioResult()?.run;
      if (narrative && scenarioRun && pending(narrative.status)) {
        this.api.scenarioNarrative(scenarioRun.id).subscribe({
          next: (report) => {
            this.scenarioNarrative.set(report);
            this.schedulePoll();
          },
          error: () => undefined,
        });
      }
      const scenario = this.scenarioResult();
      if (scenario && pending(scenario.run.status)) {
        this.api.scenario(scenario.run.id).subscribe({
          next: (result) => {
            this.scenarioResult.set(result);
            this.scenarioRunning.set(pending(result.run.status));
            if (result.run.status === 'FAILED') this.notifications.showError('ai.cashflow.scenario_failed');
            this.schedulePoll();
          },
          error: () => this.scenarioRunning.set(false),
        });
      }
    });
  }
}
