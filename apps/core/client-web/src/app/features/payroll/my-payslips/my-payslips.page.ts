import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, FileText } from 'lucide-angular';
import { catchError, of } from 'rxjs';
import { ListShellComponent } from '../../../shared/components/gestures';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { Payslip, PayrollService } from '../../../core/api/payroll.service';

/**
 * A person's own payslips.
 *
 * The endpoint — `GET /payroll/me/payslips`, guarded by `payroll:view_own` rather than by the
 * permission that opens everybody's pay — existed with nothing calling it. It is the one payroll
 * screen an ordinary employee has any business seeing, and the whole point of the separate
 * permission is that they can see it without seeing the rest.
 */
@Component({
  selector: 'app-my-payslips-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './my-payslips.page.html',
  styleUrls: ['./my-payslips.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyPayslipsPage {
  private readonly payroll = inject(PayrollService);

  protected readonly FileIcon = FileText;

  readonly payslips = signal<Payslip[]>([]);
  readonly loading = signal(true);
  readonly failed = signal(false);
  readonly open = signal<string | null>(null);

  readonly isEmpty = computed(() => !this.loading() && this.payslips().length === 0);

  constructor() {
    this.payroll.myPayslips().pipe(catchError(() => of(null))).subscribe((rows) => {
      this.payslips.set(rows ?? []);
      this.loading.set(false);
      this.failed.set(rows === null);
    });
  }

  toggle(id: string): void {
    this.open.update((current) => (current === id ? null : id));
  }
}
