import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Filter, FileDown, ArrowUp, ArrowDown } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

export interface VarianceItem {
  accountCode: string;
  accountName: string;
  actual: number;
  budget: number;
  varianceAmount: number;
  variancePercent: number;
  /** `REVENUE` inverts the sign convention: over budget is good on income, bad on expense. */
  accountType: 'REVENUE' | 'EXPENSE';
  currencyCode?: string;
}

/**
 * Actual against budget, per account, for a period.
 *
 * ## Why this page shows nothing
 *
 * It used to show five rows of invented figures — "Sales Revenue, actual 250,000, budget
 * 240,000" — hardcoded into the component. In an accounting product a reader has no way to tell
 * an invented number from their own, and a variance report is read to make decisions. Displaying
 * a plausible fabrication is worse than displaying nothing, so it now displays nothing and says
 * why.
 *
 * The report needs an endpoint that aggregates posted amounts per account over a period and
 * joins them to the budget lines. `GET /budgets` returns the budgets; nothing returns the
 * actuals. Until that exists the table renders its empty state; when it does, `variances` takes
 * the response and no part of the presentation changes.
 *
 * ## Two things this page already gets right, and must keep
 *
 * The sign convention is data, not vocabulary: it used to be decided by searching the account's
 * ENGLISH name for "revenue" or "sales", which silently inverted the arrow for every tenant
 * whose chart of accounts is in Spanish or Portuguese — which is all of them. It reads
 * `accountType` instead.
 *
 * The amount column is money, so it carries a currency. The header used to read "Variance ($)".
 */
@Component({
  selector: 'app-variance-analysis-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES],
  templateUrl: './variance-analysis.page.html',
  styleUrls: ['./variance-analysis.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VarianceAnalysisPage {
  protected readonly FilterIcon = Filter;
  protected readonly ExportIcon = FileDown;
  protected readonly PositiveIcon = ArrowDown;
  protected readonly NegativeIcon = ArrowUp;

  readonly variances = signal<VarianceItem[]>([]);
  readonly isEmpty = computed(() => this.variances().length === 0);

  isVariancePositive(item: VarianceItem): boolean {
    return item.accountType === 'REVENUE' ? item.varianceAmount >= 0 : item.varianceAmount <= 0;
  }
}
