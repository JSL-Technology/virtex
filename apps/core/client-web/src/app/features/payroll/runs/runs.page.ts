import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '../../../core/i18n/pipes/format.pipes';
import { NotificationService } from '../../../core/services/notification';
import {
  PayrollRun,
  PayrollRunStatus,
  PayrollRunType,
  PayrollService,
} from '../../../core/api/payroll.service';

const STATUS_CLASS: Record<PayrollRunStatus, string> = {
  DRAFT: 'status-draft',
  CALCULATED: 'status-pending',
  APPROVED: 'status-approved',
  PAID: 'status-sent',
  CANCELLED: 'status-rejected',
};

/**
 * Payroll runs.
 *
 * ## What existed
 *
 * Twenty-two payroll endpoints and no screen. The run lifecycle, the variable inputs, the payslips,
 * the concept catalogue, the statutory parameters and the three TSS filings were all live and all
 * unreachable: the product's only HR page was a placeholder with a heading and a sentence. A tenant
 * could pay their staff through this software only by writing HTTP requests.
 */
@Component({
  selector: 'app-payroll-runs-page',
  standalone: true,
  imports: [CommonModule, RouterLink, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './runs.page.html',
  styleUrls: ['./runs.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PayrollRunsPage {
  private readonly payroll = inject(PayrollService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  protected readonly AddIcon = Plus;

  readonly runs = signal<PayrollRun[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly creating = signal(false);
  readonly busy = signal(false);

  // A new run defaults to the month just ended, which is the one being paid.
  readonly newYear = signal(previousMonth().year);
  readonly newMonth = signal(previousMonth().month);
  readonly newType = signal<PayrollRunType>('REGULAR');

  readonly isEmpty = computed(() => !this.loading() && this.runs().length === 0);

  constructor() {
    this.reload();
  }

  create(): void {
    this.busy.set(true);
    this.payroll
      .createRun({
        periodYear: this.newYear(),
        periodMonth: this.newMonth(),
        runType: this.newType(),
      })
      .subscribe({
        next: (run) => {
          this.busy.set(false);
          this.creating.set(false);
          void this.router.navigate(['/payroll/runs', run.id]);
        },
        error: (error: { error?: { message?: string } }) => {
          this.busy.set(false);
          this.notifications.showError(
            error?.error?.message ?? 'PAYROLL.RUNS.CREATE_FAILED',
          );
        },
      });
  }

  statusClass(status: PayrollRunStatus): string {
    return STATUS_CLASS[status] ?? 'status-draft';
  }

  /** `2026-09`. The period, not the pay date: two runs can pay on the same day. */
  periodOf(run: PayrollRun): string {
    return `${run.periodYear}-${String(run.periodMonth).padStart(2, '0')}`;
  }

  private reload(): void {
    this.loading.set(true);
    this.payroll.listRuns().pipe(catchError(() => of(null))).subscribe((page) => {
      this.runs.set(page?.rows ?? []);
      this.loading.set(false);
      this.failed.set(page === null);
    });
  }
}

function previousMonth(): { year: number; month: number } {
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}
