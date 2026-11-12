import { VX_DATE } from '../../../shared/components/date';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { Observable, catchError, filter, forkJoin, map, of, take } from 'rxjs';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxBadgeComponent, VxTone } from '../../../shared/components/badge';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { CountryPackService } from '../../../core/api/country-pack.service';
import { CountryNamesService } from '../../../core/i18n/countries';
import { saveFile } from '../../../core/api/data-transfer.service';
import {
  FiscalReturnFiling,
  FiscalReturnsService,
  ReturnFiling,
  ReturnFilingOption,
} from '../data/fiscal-returns.service';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';

/**
 * Where one month's return stands, as the calendar colours it. `not_applicable` is a month before
 * the company had anything to report (QA A-15).
 */
export type CellState = 'missing' | 'overdue' | 'generated' | 'submitted' | 'changed' | 'not_applicable';

const STATE_TONE: Record<CellState, VxTone> = {
  missing: 'neutral',
  overdue: 'danger',
  generated: 'info',
  submitted: 'ok',
  changed: 'warning',
  not_applicable: 'neutral',
};

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Fiscal returns (audit H-08): the periodic files a tax authority receives, and a calendar of
 * which months were generated and filed — NetSuite's *Tax Reports*, Odoo's *Tax Returns*.
 *
 * The 606/607 sat in Settings › Fiscal as a form that produced a file and forgot it; the 608 and
 * 609 had no screen at all, and neither did Mexico's electronic accounting. Here each month shows
 * whether its file was generated (with how many records), filed (with the acknowledgement), or
 * changed after filing — the case that calls for a rectifying return.
 */
@Component({
  selector: 'app-fiscal-returns-page',
  standalone: true,
  imports: [...VX_DATE, FormsModule, ...VX_FORM_A11Y, RouterLink, TranslateModule, ...FORMAT_PIPES, ListShellComponent, VxBadgeComponent],
  templateUrl: './fiscal-returns.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './fiscal-returns.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FiscalReturnsPage implements OnInit {
  private readonly returns = inject(FiscalReturnsService);
  private readonly countryPack = inject(CountryPackService);
  private readonly countryNames = inject(CountryNamesService);
  /** The pack once it has been read (or failed), for the one decision `ngOnInit` waits on. */
  private readonly packReady$ = toObservable(this.countryPack.pack).pipe(
    filter((pack) => pack !== undefined),
    take(1),
  );
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthService);

  private readonly today = new Date();

  /**
   * What this company's market files, as the server answers it.
   *
   * The page used to carry the list: the four Dominican formats, the three Mexican documents and a
   * `switch` on the country between them, so a market the product gained filed nothing here until
   * this file was edited too.
   */
  readonly available = signal<readonly ReturnFiling[]>([]);

  /**
   * The first day the company had anything to report (QA A-15). The calendar used to start every
   * January, and a company created in September saw eight months of every return as «Overdue».
   */
  readonly activeSince = signal<string | null>(null);

  /**
   * The day of the following month a return falls due, from the market's pack: the DGII's 15th.
   * Mexico's deadlines depend on the kind of taxpayer (the 3rd or the 5th of the second month after,
   * and a different rule for the Catálogo), which the product does not record — so its pack names no
   * day and nothing is flagged overdue there rather than the wrong month.
   */
  readonly dueDay = computed(() => this.countryPack.pack()?.fiscalReturns.dueDay ?? null);

  /** Where the product generates no return files: the market's name and the reports to use instead. */
  readonly countryName = computed(() => this.countryNames.nameOf(this.countryPack.pack()?.countryCode));
  readonly prepareWith = computed(() => this.countryPack.pack()?.fiscalReturns.prepareWith ?? []);
  readonly year = signal(this.today.getFullYear());
  readonly filings = signal<FiscalReturnFiling[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  /** The action in flight, as `kind:month:action`, so only its button shows progress. */
  readonly busy = signal<string | null>(null);
  readonly selected = signal<{ kind: string; month: number } | null>(null);

  /** What each filing's own options are set to, keyed `code.option`. */
  readonly optionValues = signal<Readonly<Record<string, string>>>({});

  /** The month an on-request filing is asked for, keyed by its code. */
  readonly requestMonths = signal<Readonly<Record<string, number>>>({});

  readonly canFile = computed(() => this.auth.hasPermissions(['accounting:close_period']));

  /** The filings with a monthly deadline: the calendar's columns, in the market's own order. */
  readonly kinds = computed(() => this.available().filter((filing) => filing.tracked));

  /**
   * The filings an authority asks for when it audits, refunds or offsets: each gets its own panel,
   * because there is no month of theirs that is «not filed».
   */
  readonly onRequest = computed(() => this.available().filter((filing) => filing.periodicity === 'ON_REQUEST'));

  /** The months of the year that have begun: a future month has nothing to file yet. */
  readonly months = computed(() => {
    const year = this.year();
    const current = this.today.getFullYear();
    const last = year < current ? 12 : year > current ? 0 : this.today.getMonth() + 1;
    return Array.from({ length: last }, (_, index) => index + 1);
  });

  /** From this year back to the year the company started reporting; never a year before it existed. */
  readonly years = computed(() => {
    const current = this.today.getFullYear();
    const first = Number((this.activeSince() ?? '').slice(0, 4)) || current - 5;
    const span = Math.max(1, Math.min(current - first + 1, 6));
    return Array.from({ length: span }, (_, index) => current - index);
  });

  readonly empty = computed(
    () => !this.loading() && !this.error() && (this.kinds().length === 0 || this.months().length === 0),
  );

  /** Nothing is filed from here in this market: the reports to prepare the returns with instead. */
  readonly filesNothing = computed(() => this.available().length === 0);

  readonly selectedFiling = computed(() => {
    const cell = this.selected();
    return cell ? this.filingOf(cell.kind, cell.month) : null;
  });

  /** Months filed whose data changed afterwards, across the year. */
  readonly changedCount = computed(() => this.filings().filter((filing) => filing.changedSinceSubmission).length);

  /**
   * What this market files comes from the server, and where the calendar starts from the company's
   * own history.
   */
  ngOnInit(): void {
    forkJoin({
      pack: this.packReady$,
      available: this.returns.available().pipe(catchError(() => of([] as ReturnFiling[]))),
      since: this.returns.activeSince().pipe(
        map((answer) => answer.activeSince),
        catchError(() => of(null)),
      ),
    }).subscribe(({ pack, available, since }) => {
      if (!pack) {
        this.error.set('fiscal_returns.load_failed');
        this.loading.set(false);
        return;
      }
      this.activeSince.set(since);
      // Only what this user may take: a filing that names a permission they do not hold is not
      // offered, rather than offered and refused by the server.
      this.available.set(available.filter((filing) => !filing.permission || this.auth.hasPermissions([filing.permission])));
      this.requestMonths.set(
        Object.fromEntries(
          available.filter((filing) => filing.periodicity === 'ON_REQUEST').map((filing) => [filing.code, this.today.getMonth() + 1]),
        ),
      );
      this.load();
    });
  }

  load(): void {
    if (this.filesNothing()) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    this.returns.filings(this.year()).subscribe({
      next: (rows) => {
        this.filings.set(rows);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(error, 'fiscal_returns.load_failed'));
        this.loading.set(false);
      },
    });
  }

  setYear(year: number): void {
    this.year.set(Number(year));
    this.selected.set(null);
    this.load();
  }

  select(kind: string, month: number): void {
    const current = this.selected();
    this.selected.set(current?.kind === kind && current.month === month ? null : { kind, month });
    // Another cell, another filing: what was typed for the last one is not carried over.
    this.optionValues.set({});
  }

  isSelected(kind: string, month: number): boolean {
    const current = this.selected();
    return current?.kind === kind && current.month === month;
  }

  filingOf(kind: string, month: number): FiscalReturnFiling | null {
    return this.filings().find((filing) => filing.kind === kind && filing.month === month) ?? null;
  }

  state(kind: string, month: number): CellState {
    const filing = this.filingOf(kind, month);
    if (filing?.status === 'SUBMITTED') return filing.changedSinceSubmission ? 'changed' : 'submitted';
    // Nothing to file for a month the company had not started — neutral, never «Overdue» (QA A-15).
    if (!filing && this.beforeActivity(month)) return 'not_applicable';
    if (this.dueDay() !== null && this.isPastDue(month)) return 'overdue';
    return filing ? 'generated' : 'missing';
  }

  /** The month ended before the company's first day with anything to report. */
  beforeActivity(month: number): boolean {
    const since = this.activeSince();
    return since !== null && `${this.year()}-${pad(month)}` < since.slice(0, 7);
  }

  tone(kind: string, month: number): VxTone {
    return STATE_TONE[this.state(kind, month)];
  }

  /** `2026-08-01`, for the month name through the date pipe. */
  monthDate(month: number): string {
    return `${this.year()}-${pad(month)}-01`;
  }

  /** A month's due date: the market's due day of the following month. */
  dueDate(month: number): string {
    const due = new Date(this.year(), month, this.dueDay() ?? 1);
    return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
  }

  isBusy(kind: string, month: number, action: string): boolean {
    return this.busy() === `${kind}:${month}:${action}`;
  }

  download(kind: string, month: number): void {
    this.run(
      kind,
      month,
      'download',
      () => this.returns.download(kind, this.year(), month, this.optionsOf(kind)),
      ({ blob, fileName }) => {
        saveFile({ blob, fileName });
        this.load();
      },
      'fiscal_returns.download_failed',
    );
  }

  // ── The options a filing declares ──────────────────────────────────────────

  /** What this filing's options are set to, by the authority's own names for them. */
  optionsOf(code: string): Record<string, string> {
    const values = this.optionValues();
    return Object.fromEntries(
      this.optionsFor(code)
        .map((option) => [option.name, values[`${code}.${option.name}`] ?? ''])
        .filter(([, value]) => value),
    );
  }

  /** The name of a filing, as its own market calls it. */
  labelOf(code: string): string {
    return this.available().find((filing) => filing.code === code)?.labelKey ?? code;
  }

  /** What a filing asks for beyond the period, as its market declares it. */
  optionsFor(code: string): readonly ReturnFilingOption[] {
    return this.available().find((filing) => filing.code === code)?.options ?? [];
  }

  /**
   * The catalogue key for one of an option's published values.
   *
   * The authority writes its codes in upper case (`AF`, `C`); a catalogue leaf is lower case, as
   * every composed family in this product is.
   */
  optionValueLabel(option: ReturnFilingOption, value: string): string {
    return `${option.labelKey}.${value.toLowerCase()}`;
  }

  optionValue(code: string, option: ReturnFilingOption): string {
    return this.optionValues()[`${code}.${option.name}`] ?? '';
  }

  setOption(code: string, option: ReturnFilingOption, value: string): void {
    this.optionValues.update((values) => ({ ...values, [`${code}.${option.name}`]: value }));
  }

  requestMonth(code: string): number {
    return this.requestMonths()[code] ?? this.today.getMonth() + 1;
  }

  setRequestMonth(code: string, month: number): void {
    this.requestMonths.update((months) => ({ ...months, [code]: Number(month) }));
  }

  /** An on-request filing: its own month and its own options, with no cell in the calendar. */
  downloadOnRequest(code: string): void {
    const month = this.requestMonth(code);
    this.run(
      code,
      month,
      'download',
      () => this.returns.download(code, this.year(), month, this.optionsOf(code)),
      ({ blob, fileName }) => saveFile({ blob, fileName }),
      'fiscal_returns.download_failed',
    );
  }

  check(kind: string, month: number): void {
    this.run(kind, month, 'check', () => this.returns.check(kind, this.year(), month), (filing) => {
      this.replace(filing);
      this.notifications.showInfo(
        filing.changedSinceSubmission ? 'fiscal_returns.check_changed' : 'fiscal_returns.check_done',
        { count: filing.recordCount },
      );
    }, 'fiscal_returns.check_failed');
  }

  async markSubmitted(kind: string, month: number): Promise<void> {
    const reference = await this.dialog.prompt({
      title: 'fiscal_returns.submit_title',
      message: 'fiscal_returns.submit_message',
      messageParams: { kind, period: `${this.year()}-${pad(month)}` },
      placeholder: 'fiscal_returns.submit_placeholder',
      confirmText: 'fiscal_returns.submit_confirm',
      minLength: 1,
      tooShort: 'fiscal_returns.reference_required',
    });
    if (!reference?.trim()) return;
    this.run(kind, month, 'submit', () => this.returns.markSubmitted(kind, this.year(), month, reference.trim()), (filing) => {
      this.replace(filing);
      this.notifications.showSuccess('fiscal_returns.submitted');
    }, 'fiscal_returns.submit_failed');
  }

  async clearSubmission(kind: string, month: number): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'fiscal_returns.clear_title',
      message: 'fiscal_returns.clear_message',
      messageParams: { kind, period: `${this.year()}-${pad(month)}` },
      confirmText: 'fiscal_returns.clear_confirm',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.run(kind, month, 'clear', () => this.returns.clearSubmission(kind, this.year(), month), (filing) => {
      this.replace(filing);
      this.notifications.showInfo('fiscal_returns.cleared');
    }, 'fiscal_returns.clear_failed');
  }

  private replace(filing: FiscalReturnFiling): void {
    this.filings.update((rows) => [
      ...rows.filter((row) => !(row.kind === filing.kind && row.month === filing.month)),
      filing,
    ]);
  }

  private run<T>(
    kind: string,
    month: number,
    action: string,
    call: () => Observable<T>,
    done: (value: T) => void,
    failureKey: string,
  ): void {
    this.busy.set(`${kind}:${month}:${action}`);
    call().subscribe({
      next: (value) => {
        this.busy.set(null);
        done(value);
      },
      error: (error: unknown) => {
        this.busy.set(null);
        this.notifications.showHttpError(error, failureKey);
      },
    });
  }

  private isPastDue(month: number): boolean {
    const due = new Date(this.year(), month, this.dueDay() ?? 1, 23, 59, 59);
    return this.today.getTime() > due.getTime();
  }
}
