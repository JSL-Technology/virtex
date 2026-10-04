import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, AlertCircle, CheckCircle, Info } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { AuthService } from '../../../../core/services/auth';
import { DialogService } from '../../../../core/services/dialog.service';
import { NotificationService } from '../../../../core/services/notification';
import { ActiveOrganizationService } from '../../../../core/tenancy/active-organization.service';
import { VX_SELECT } from '../../../../shared/components/select';
import { FiscalYear, FiscalYearsService, YearEndCheckId, YearEndReadiness } from '../../data/fiscal-years.service';

/** The copy and the place to fix each check. Literal keys, so the catalogue check sees them. */
const CHECKS: Record<YearEndCheckId, { label: string; failing: string; link?: string; fragment?: string }> = {
  periods_exist: { label: 'accounting.annual_close.check.periods_exist', failing: 'accounting.annual_close.check.periods_exist_failing', link: '/accounting/periods' },
  periods_closed: { label: 'accounting.annual_close.check.periods_closed', failing: 'accounting.annual_close.check.periods_closed_failing', link: '/accounting/periods' },
  entries_posted: { label: 'accounting.annual_close.check.entries_posted', failing: 'accounting.annual_close.check.entries_posted_failing', link: '/accounting/journal-entries' },
  retained_earnings: { label: 'accounting.annual_close.check.retained_earnings', failing: 'accounting.annual_close.check.retained_earnings_failing', fragment: 'settings/accounting' },
  closing_journal: { label: 'accounting.annual_close.check.closing_journal', failing: 'accounting.annual_close.check.closing_journal_failing', link: '/accounting/journals' },
  default_ledger: { label: 'accounting.annual_close.check.default_ledger', failing: 'accounting.annual_close.check.default_ledger_failing', link: '/accounting/ledgers' },
  earlier_years_closed: { label: 'accounting.annual_close.check.earlier_years_closed', failing: 'accounting.annual_close.check.earlier_years_closed_failing' },
};

/**
 * The year-end close (QA M-09: «Cierre anual: no disponible»).
 *
 * The close itself existed (`POST /accounting/year-end-close`) and nothing could reach it. This
 * screen picks the year, asks the server what stands in the way — each precondition the close
 * enforces, with the figures to act on and a link to where it is fixed — shows the result that
 * will move to retained earnings, and only then offers the close, behind a confirmation. A closed
 * year shows its closing entry and can be reopened, with the reason the server requires.
 */
@Component({
  selector: 'app-annual-close-page',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslateModule, LucideAngularModule, ...VX_SELECT, ...FORMAT_PIPES],
  templateUrl: './annual-close.page.html',
  styleUrls: ['./annual-close.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnnualClosePage implements OnInit {
  private readonly years = inject(FiscalYearsService);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly organization = inject(ActiveOrganizationService);

  protected readonly OkIcon = CheckCircle;
  protected readonly BlockIcon = AlertCircle;
  protected readonly AdviceIcon = Info;

  readonly fiscalYears = signal<FiscalYear[]>([]);
  readonly selectedId = signal<string | null>(null);
  readonly readiness = signal<YearEndReadiness | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly working = signal(false);

  readonly canReopen = this.auth.hasPermissions(['accounting:reopen_year']);
  readonly yearLabel = (year: FiscalYear): string => `${year.startDate} – ${year.endDate}`;
  readonly yearValue = (year: FiscalYear): string => year.id;

  readonly checks = computed(() =>
    (this.readiness()?.checks ?? []).map((check) => {
      const copy = CHECKS[check.id];
      return {
        ...check,
        text: check.ok ? copy.label : copy.failing,
        link: !check.ok && copy.link ? this.organization.urlFor(copy.link) : null,
        fragment: !check.ok ? copy.fragment ?? null : null,
      };
    }),
  );

  readonly closingEntryLink = computed(() => {
    const id = this.readiness()?.fiscalYear.closingJournalEntryId;
    return id ? this.organization.urlFor(`/accounting/journal-entries/${id}/edit`) : null;
  });

  ngOnInit(): void {
    this.loadYears();
  }

  loadYears(): void {
    this.loading.set(true);
    this.error.set(null);
    this.years.list().subscribe({
      next: (years) => {
        this.fiscalYears.set(years);
        // The year a close is usually about: the oldest one still open.
        const oldestOpen = [...years].reverse().find((year) => year.status === 'OPEN');
        this.select(oldestOpen?.id ?? years[0]?.id ?? null);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'accounting.annual_close.load_failed'));
      },
    });
  }

  select(id: string | null): void {
    this.selectedId.set(id);
    this.readiness.set(null);
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.years.readiness(id).subscribe({
      next: (readiness) => {
        this.readiness.set(readiness);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loading.set(false);
        this.error.set(this.notifications.httpErrorMessage(error, 'accounting.annual_close.load_failed'));
      },
    });
  }

  async close(): Promise<void> {
    const readiness = this.readiness();
    if (!readiness?.canClose) return;
    const confirmed = await this.dialog.confirm({
      title: 'accounting.annual_close.confirm_title',
      message: 'accounting.annual_close.confirm_message',
      messageParams: { from: readiness.fiscalYear.startDate, to: readiness.fiscalYear.endDate },
      confirmText: 'accounting.annual_close.close',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.working.set(true);
    this.years.close(readiness.fiscalYear.id).subscribe({
      next: ({ messageKey, messageParams }) => {
        this.working.set(false);
        this.notifications.showSuccess(messageKey, messageParams);
        this.loadYears();
      },
      error: (error: unknown) => {
        this.working.set(false);
        this.notifications.showHttpError(error, 'accounting.annual_close.close_failed');
        this.select(readiness.fiscalYear.id);
      },
    });
  }

  async reopen(): Promise<void> {
    const readiness = this.readiness();
    if (!readiness || readiness.fiscalYear.status !== 'CLOSED') return;
    const reason = await this.dialog.prompt({
      title: 'accounting.annual_close.reopen_title',
      message: 'accounting.annual_close.reopen_message',
      placeholder: 'dialog.reopen_period.reason_reopening',
      minLength: 10,
      tooShort: 'accounting.periods.reason_too_short',
      variant: 'warning',
    });
    if (!reason) return;
    this.working.set(true);
    this.years.reopen(readiness.fiscalYear.id, reason).subscribe({
      next: ({ messageKey, messageParams }) => {
        this.working.set(false);
        this.notifications.showSuccess(messageKey, messageParams);
        this.loadYears();
      },
      error: (error: unknown) => {
        this.working.set(false);
        this.notifications.showHttpError(error, 'accounting.annual_close.reopen_failed');
      },
    });
  }
}
