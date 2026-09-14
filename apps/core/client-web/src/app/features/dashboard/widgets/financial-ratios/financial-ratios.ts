import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Info } from 'lucide-angular';
import { TranslateModule } from '@ngx-translate/core';
import { catchError, combineLatest, map, of } from 'rxjs';
import { DashboardApiService } from '../../../../core/api/dashboard-api.service';
import { FormatService } from '@virteex/shared/ui-i18n';

/** One ratio, ready to render: a label key, a formatted value and how it reads. */
interface FinancialRatio {
  key: string;
  value: string;
  status: 'good' | 'warning' | 'danger' | 'neutral';
}

/**
 * The ratios strip of the executive dashboard.
 *
 * ## What this was
 *
 * Five hardcoded figures — ROE 15.2 %, ROA 8.1 %, current ratio 2.1, acid test 1.2, working capital
 * $250.8K — with Spanish names and Spanish tooltips baked in. They were identical for every tenant
 * and never moved, while the very same page carried nine KPI tiles computing those same ratios from
 * the ledger through `/dashboard/kpi/*`. The numbers on one half of the screen contradicted the
 * other half.
 *
 * Same endpoints, same arithmetic, one source.
 */
@Component({
  selector: 'app-financial-ratios',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule],
  templateUrl: './financial-ratios.html',
  styleUrls: ['./financial-ratios.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FinancialRatios {
  private readonly api = inject(DashboardApiService);
  private readonly format = inject(FormatService);

  protected readonly InfoIcon = Info;

  private readonly figures = toSignal(
    combineLatest({
      roe: this.api.getROE().pipe(catchError(() => of(null))),
      roa: this.api.getROA().pipe(catchError(() => of(null))),
      currentRatio: this.api.getCurrentRatio().pipe(catchError(() => of(null))),
      quickRatio: this.api.getQuickRatio().pipe(catchError(() => of(null))),
      workingCapital: this.api.getWorkingCapital().pipe(catchError(() => of(null))),
    }).pipe(map((figures) => figures)),
    { initialValue: null },
  );

  /**
   * Thresholds are the textbook ones and are stated here rather than hidden in a template: a
   * current ratio under 1 means short-term obligations exceed short-term assets, which is a fact
   * about the business, not a house style.
   */
  readonly ratios = computed<FinancialRatio[]>(() => {
    const figures = this.figures();
    if (!figures) return [];

    return [
      {
        // `/dashboard/kpi/*` returns ROE and ROA already multiplied by 100, while the percent
        // formatter takes a ratio. Passing the figure straight through reported a 4.41 % return
        // as 441 %.
        key: 'ROE',
        value: this.percent(ratioOf(figures.roe?.roe)),
        status: band(figures.roe?.roe, 10, 0),
      },
      {
        key: 'ROA',
        value: this.percent(ratioOf(figures.roa?.roa)),
        status: band(figures.roa?.roa, 5, 0),
      },
      {
        key: 'CURRENT_RATIO',
        value: this.ratio(figures.currentRatio?.currentRatio),
        status: band(figures.currentRatio?.currentRatio, 1.5, 1),
      },
      {
        key: 'QUICK_RATIO',
        value: this.ratio(figures.quickRatio?.quickRatio),
        status: band(figures.quickRatio?.quickRatio, 1, 0.8),
      },
      {
        key: 'WORKING_CAPITAL',
        value: this.money(figures.workingCapital?.workingCapital),
        status: band(figures.workingCapital?.workingCapital, 0.01, 0),
      },
    ];
  });

  private percent(value: number | undefined): string {
    return value === undefined || value === null ? '—' : this.format.percent(value);
  }


  private ratio(value: number | undefined): string {
    return value === undefined || value === null ? '—' : this.format.number(value, '1.2-2');
  }

  private money(value: number | undefined): string {
    return value === undefined || value === null ? '—' : this.format.money(value);
  }
}

/** The KPI endpoints return a percentage; the formatter takes a ratio. */
function ratioOf(value: number | undefined | null): number | undefined {
  return value === undefined || value === null ? undefined : value / 100;
}

/** Above `good` reads well, below `bad` reads badly, and in between is worth a second look. */
function band(
  value: number | undefined | null,
  good: number,
  bad: number,
): FinancialRatio['status'] {
  if (value === undefined || value === null || Number.isNaN(value)) return 'neutral';
  if (value >= good) return 'good';
  if (value >= bad) return 'warning';
  return 'danger';
}
