import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { TranslateModule, FORMAT_PIPES } from '@virtex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virtex/shared/ui-a11y';
import { ISO_MONTH_PATTERN } from '@virtex/shared/types';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxAmountComponent } from '../../../shared/components/amount';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { OrganizationSettingsService } from '../../settings/data/organization-settings.service';
import { previousMonth } from '../fixed-assets/depreciation-run.page';
import {
  InflationAdjustmentService,
  PriceIndexSeries,
  PriceIndexValue,
  RestatementLine,
  RestatementOutlook,
  RestatementRunSummary,
} from '../data/inflation-adjustment.service';

/** `2026-03` moved by `months`. */
export function shiftMonth(period: string, months: number): string {
  const [year, month] = period.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Restatement for inflation (IAS 29; audit 2026-11-07, FIN-AC-04): the month to restate, the index
 * every figure is multiplied by and where it came from, what each restated account would carry
 * and the gain or loss on the net monetary position the entry books — and the runs already in the
 * books, each undoable while no later month was restated on top of it.
 *
 * The close books the restatement on its own where the company's policy asks for it; this screen is
 * for seeing it before, restating a month by hand, recording a month of the index the platform has
 * not loaded yet, and replacing a run after a revised index or a late posting.
 */
@Component({
  selector: 'app-inflation-adjustment-page',
  standalone: true,
  imports: [FormsModule, ...VX_FORM_A11Y, RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxAmountComponent, HasPermissionDirective],
  templateUrl: './inflation-adjustment.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './inflation-adjustment.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InflationAdjustmentPage implements OnInit {
  private readonly adjustments = inject(InflationAdjustmentService);
  private readonly settings = inject(OrganizationSettingsService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);
  private readonly auth = inject(AuthService);

  /** The series is a company setting: choosing it takes the right to edit the company's settings. */
  protected readonly canChooseSeries = this.auth.hasPermissions(['settings:edit_company']);

  readonly period = signal(previousMonth());
  readonly outlook = signal<RestatementOutlook | null>(null);
  readonly runs = signal<RestatementRunSummary[]>([]);
  readonly catalogue = signal<PriceIndexSeries[]>([]);
  /** The thirteen months up to the one restated: the index the screen shows. */
  readonly indexMonths = signal<PriceIndexValue[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  /** A month of the index the company records for itself. */
  readonly entryPeriod = signal(previousMonth());
  readonly entryValue = signal('');
  readonly entryReference = signal('');

  /**
   * The restatement on screen: the month's plan when nothing is booked; the full restatement as a
   * replacement would book it when a run is there — what the books carry, or should.
   */
  readonly shown = computed(() => {
    const outlook = this.outlook();
    if (!outlook) return null;
    return outlook.run ? (outlook.replacement ?? outlook) : outlook;
  });
  readonly accounts = computed<RestatementLine[]>(() => this.shown()?.accounts ?? []);
  readonly blockers = computed(() => this.outlook()?.blockers ?? []);
  readonly series = computed(() => this.catalogue().find((entry) => entry.code === this.outlook()?.seriesCode) ?? null);
  /** The latest month restated in the books: the only run that can be undone. */
  readonly latestPosted = computed(() => this.runs().find((run) => run.status === 'POSTED') ?? null);
  readonly empty = computed(() => !this.loading() && !this.error() && this.accounts().length === 0 && this.blockers().length === 0);
  readonly canPost = computed(() => {
    const outlook = this.outlook();
    return !!outlook && outlook.blockers.length === 0 && (!outlook.run || outlook.current === false);
  });

  ngOnInit(): void {
    this.adjustments.series().pipe(catchError(() => of([] as PriceIndexSeries[]))).subscribe((series) => this.catalogue.set(series));
    this.load();
  }

  load(): void {
    const period = this.period();
    if (!ISO_MONTH_PATTERN.test(period)) return;
    this.loading.set(true);
    this.error.set(null);
    forkJoin({
      outlook: this.adjustments.outlook(period),
      runs: this.adjustments.runs(),
    }).subscribe({
      next: ({ outlook, runs }) => {
        this.outlook.set(outlook);
        this.runs.set(runs);
        this.loading.set(false);
        this.loadIndex(outlook.seriesCode, period);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'inflation_adjustment.page.load_failed'));
        this.loading.set(false);
      },
    });
  }

  private loadIndex(series: string | null, period: string): void {
    if (!series) {
      this.indexMonths.set([]);
      return;
    }
    this.adjustments
      .values(series, shiftMonth(period, -12), period)
      .pipe(catchError(() => of([] as PriceIndexValue[])))
      .subscribe((values) => this.indexMonths.set([...values].reverse()));
  }

  setPeriod(period: string): void {
    this.period.set(period);
    this.entryPeriod.set(period);
    this.load();
  }

  /** The series the company restates with: one its market prescribes, saved in its closing settings. */
  chooseSeries(code: string): void {
    this.settings.update('closing', { fields: { inflationIndexSeriesCode: code || null } }).subscribe({
      next: () => {
        this.notifications.showSuccess('inflation_adjustment.page.series_saved');
        this.load();
      },
      error: (error: unknown) => this.notifications.showHttpError(error, 'inflation_adjustment.page.series_failed'),
    });
  }

  async post(): Promise<void> {
    const outlook = this.outlook();
    if (!outlook || !this.canPost()) return;
    const replace = !!outlook.run;
    const plan = this.shown();
    const confirmed = await this.dialog.confirm({
      title: replace ? 'inflation_adjustment.page.replace_title' : 'inflation_adjustment.page.post_title',
      message: replace ? 'inflation_adjustment.page.replace_message' : 'inflation_adjustment.page.post_message',
      messageParams: { period: outlook.period, count: plan?.lines.length ?? 0, result: plan?.netMonetaryResult ?? '0.00' },
      confirmText: replace ? 'inflation_adjustment.page.replace' : 'inflation_adjustment.page.post',
    });
    if (!confirmed) return;
    this.busy.set(true);
    this.adjustments.post(outlook.period, replace).subscribe({
      next: ({ created }) => {
        this.busy.set(false);
        this.notifications.showSuccess(created ? 'inflation_adjustment.page.posted' : 'inflation_adjustment.page.already_posted', {
          period: outlook.period,
        });
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'inflation_adjustment.page.post_failed');
      },
    });
  }

  async reverse(run: RestatementRunSummary): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'inflation_adjustment.page.reverse_title',
      message: 'inflation_adjustment.page.reverse_message',
      messageParams: { period: run.period },
      placeholder: 'inflation_adjustment.page.reverse_reason',
      confirmText: 'inflation_adjustment.page.reverse',
      variant: 'danger',
    });
    if (!reason?.trim()) return;
    this.busy.set(true);
    this.adjustments.reverse(run.id, reason.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.notifications.showSuccess('inflation_adjustment.page.reversed', { period: run.period });
        this.load();
      },
      error: (error: unknown) => {
        this.busy.set(false);
        this.notifications.showHttpError(error, 'inflation_adjustment.page.reverse_failed');
      },
    });
  }

  recordIndex(): void {
    const series = this.outlook()?.seriesCode;
    const value = this.entryValue().trim().replace(',', '.');
    if (!series || !ISO_MONTH_PATTERN.test(this.entryPeriod()) || !value) return;
    this.busy.set(true);
    this.adjustments
      .record(series, [{ period: this.entryPeriod(), value, ...(this.entryReference().trim() ? { reference: this.entryReference().trim() } : {}) }])
      .subscribe({
        next: ({ recorded }) => {
          this.busy.set(false);
          this.notifications.showSuccess(recorded ? 'inflation_adjustment.page.index_recorded' : 'inflation_adjustment.page.index_unchanged', {
            period: this.entryPeriod(),
          });
          this.entryValue.set('');
          this.entryReference.set('');
          this.load();
        },
        error: (error: unknown) => {
          this.busy.set(false);
          this.notifications.showHttpError(error, 'inflation_adjustment.page.index_failed');
        },
      });
  }

  entryLink(entryId: string | null): string | null {
    return entryId ? this.organization.urlFor(`/accounting/journal-entries/${entryId}/edit`) : null;
  }

  /** `Centro: A · Proyecto: X`, for a line restated per dimension combination. */
  dimensionsOf(line: RestatementLine): string {
    return Object.entries(line.dimensions ?? {})
      .map(([name, value]) => `${name}: ${value}`)
      .join(' · ');
  }
}
