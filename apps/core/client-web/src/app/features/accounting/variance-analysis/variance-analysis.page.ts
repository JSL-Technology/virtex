import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, ArrowUp, ArrowDown } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES, accountNameOf } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VX_SORT, sortable } from '../../../shared/components/sort';
import { NotificationService } from '../../../core/services/notification';
import { BudgetsService, VarianceLine, VarianceReport, isFavourable } from '../data/budgets.service';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Actual against budget, per account, over a run of months (audit H-16).
 *
 * This page used to render nothing and say why: no endpoint returned the actuals, and before that
 * it showed five invented rows. It now reads `GET /budgets/variance`, which adds up every monthly
 * budget in the range and the posted amounts of the same accounts in the same days, from the
 * tenant's default book.
 *
 * Two rules kept from before: whether a difference is good news comes from the account's TYPE
 * (over budget on income is good, on expense it is bad) — never from its name — and amounts are
 * money in the ledger's currency.
 */
@Component({
  selector: 'app-variance-analysis-page',
  standalone: true,
  imports: [...VX_SORT, FormsModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './variance-analysis.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './variance-analysis.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VarianceAnalysisPage implements OnInit {
  private readonly budgets = inject(BudgetsService);
  private readonly notifications = inject(NotificationService);

  /** `?from=YYYY-MM&to=YYYY-MM` — from a budget's own page. */
  readonly from = input<string>();
  readonly to = input<string>();

  protected readonly FavourableIcon = ArrowDown;
  protected readonly UnfavourableIcon = ArrowUp;
  protected readonly favourable = isFavourable;

  readonly report = signal<VarianceReport | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly fromPeriod = signal('');
  readonly toPeriod = signal('');

  readonly lines = computed(() => this.report()?.lines ?? []);
  readonly table = sortable(() => this.lines(), {
    account: (line) => line.accountCode ?? '',
  });
  readonly empty = computed(() => !this.loading() && !this.error() && this.lines().length === 0);
  readonly currency = computed(() => this.report()?.ledger?.currency ?? null);

  ngOnInit(): void {
    const now = new Date();
    this.fromPeriod.set(this.from() ?? `${now.getFullYear()}-01`);
    this.toPeriod.set(this.to() ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
    this.load();
  }

  load(): void {
    if (!this.fromPeriod() || !this.toPeriod()) return;
    this.loading.set(true);
    this.error.set(null);
    this.budgets.variance(this.fromPeriod(), this.toPeriod()).subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'budgets.variance.load_failed'));
        this.loading.set(false);
      },
    });
  }

  protected name(line: VarianceLine): string {
    return accountNameOf(line.accountName as Parameters<typeof accountNameOf>[0]);
  }
}
