import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, FilePlus, Paperclip } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { VxDatePipe, VxMoneyPipe } from '../../../core/i18n/pipes/format.pipes';
import {
  AdjustmentStatus,
  AuditAdjustmentsService,
  ProposedAdjustment,
} from '../../../core/api/audit-adjustments.service';
import { FiscalYear, FiscalYearsService } from '../../../core/api/fiscal-years.service';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';

/**
 * How each state reads and what colour it wears. One table, so the label and the badge cannot
 * disagree — the same reason `invoice-status.ts` exists.
 *
 * The classes are the design system's own badge utilities (`_utilities.scss`), never a colour
 * invented here.
 */
const STATUS: Record<AdjustmentStatus, { key: string; badge: string }> = {
  PENDING_APPROVAL: { key: 'audit_adjustments.status.pending_approval', badge: 'badge-warning' },
  APPROVED: { key: 'audit_adjustments.status.approved', badge: 'badge-info' },
  REJECTED: { key: 'audit_adjustments.status.rejected', badge: 'badge' },
  POSTED: { key: 'audit_adjustments.status.posted', badge: 'badge-success' },
  FAILED: { key: 'audit_adjustments.status.failed', badge: 'badge-error' },
};

/**
 * The corrections an external audit has proposed to a year that is already closed.
 *
 * ## Why there was no screen
 *
 * There was no endpoint either. `AuditAdjustmentsService`, its entities, its approval workflow and
 * the listener that posts an approved adjustment all existed on the server, registered in no
 * module and exposed by no controller — so the feature could not be reached from anywhere, and
 * nothing in the interface referred to it. See `AuditAdjustmentsController`.
 *
 * The list shows what state each proposal is in, because that is the question an auditor and a
 * controller both ask: what have I raised, what is waiting on somebody, and what has actually
 * reached the ledger.
 */
@Component({
  selector: 'app-audit-adjustments-page',
  standalone: true,
  imports: [CommonModule, RouterModule, LucideAngularModule, TranslateModule, ListShellComponent, VxDatePipe, VxMoneyPipe, ...FORMAT_PIPES],
  templateUrl: './audit-adjustments.page.html',
  styleUrls: ['./audit-adjustments.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuditAdjustmentsPage {
  private readonly adjustments = inject(AuditAdjustmentsService);
  private readonly fiscalYears = inject(FiscalYearsService);
  private readonly router = inject(Router);

  protected readonly NewIcon = FilePlus;
  protected readonly EvidenceIcon = Paperclip;

  readonly rows = signal<ProposedAdjustment[]>([]);
  readonly years = signal<FiscalYear[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly fiscalYearId = signal('');

  readonly isEmpty = computed(() => !this.loading() && this.rows().length === 0);

  constructor() {
    this.fiscalYears
      .list()
      .pipe(catchError(() => of([])))
      .subscribe((years) => this.years.set(years));
    this.reload();
  }

  statusKey(status: AdjustmentStatus): string {
    return STATUS[status]?.key ?? status;
  }

  statusBadge(status: AdjustmentStatus): string {
    return STATUS[status]?.badge ?? 'badge';
  }

  /** The year a proposal belongs to, as `2025-01-01 – 2025-12-31`. */
  yearLabel(fiscalYearId: string): string {
    const year = this.years().find((candidate) => candidate.id === fiscalYearId);
    return year ? `${year.startDate} – ${year.endDate}` : fiscalYearId.slice(0, 8);
  }

  /** The net of the proposal, which is what the reader scans the list for. */
  amountOf(adjustment: ProposedAdjustment): number {
    return (adjustment.lines ?? []).reduce((total, line) => total + Number(line.debit ?? 0), 0);
  }

  filterByYear(fiscalYearId: string): void {
    this.fiscalYearId.set(fiscalYearId);
    this.reload();
  }

  propose(): void {
    this.router.navigate(['/accounting/audit-adjustments/new']);
  }

  reload(): void {
    this.loading.set(true);
    this.adjustments
      .list({ fiscalYearId: this.fiscalYearId() || undefined, pageSize: 50 })
      .pipe(catchError(() => of(null)))
      .subscribe((page) => {
        this.rows.set(page?.rows ?? []);
        this.loading.set(false);
        this.failed.set(page === null);
      });
  }
}
