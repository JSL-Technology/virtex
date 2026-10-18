import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, Printer, Sparkles } from 'lucide-angular';
import { Subscription, timer } from 'rxjs';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { NotificationService } from '../../../core/services/notification';
import { ManagerReport, ManagerReportService, ManagerReportSummary } from './manager-report.service';

const POLL_MS = 5000;
const pending = (status: string | undefined | null) => status === 'QUEUED' || status === 'RUNNING';

/** `YYYY-MM` of the month before `date`. */
export function previousPeriod(date = new Date()): string {
  const d = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Analysis › Manager's report.
 *
 * The month in a few paragraphs for whoever runs the company: how it went, where cash is heading,
 * who owes and who is owed, what inventory and the anomaly checks say, and what to do next month.
 * Written on the 1st for the month that ended, and on request for any closed month, from the
 * figures the system computed — every figure in it is one of those, checked before it is stored.
 * Printed (or saved as PDF) from the browser.
 */
@Component({
  selector: 'app-manager-report-page',
  standalone: true,
  imports: [FormsModule, TranslateModule, LucideAngularModule, ...FORMAT_PIPES, ...VX_FORM_A11Y],
  templateUrl: './manager-report.page.html',
  styleUrl: './manager-report.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ManagerReportPage implements OnInit {
  private readonly api = inject(ManagerReportService);
  private readonly notifications = inject(NotificationService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly WriteIcon = Sparkles;
  protected readonly PrintIcon = Printer;

  readonly reports = signal<ManagerReportSummary[]>([]);
  readonly report = signal<ManagerReport | null>(null);
  readonly loading = signal(true);
  readonly requesting = signal(false);
  /** The month asked for, `YYYY-MM`; the latest closed one by default. */
  readonly period = signal(previousPeriod());
  readonly maxPeriod = previousPeriod();

  readonly content = computed(() => this.report()?.content ?? null);
  readonly writing = computed(() => pending(this.report()?.status));
  readonly unavailable = computed(() => (this.report()?.facts?.['unavailable'] as string[] | undefined) ?? []);

  private polling: Subscription | null = null;

  ngOnInit(): void {
    this.destroyRef.onDestroy(() => this.polling?.unsubscribe());
    const wanted = this.route.snapshot.queryParamMap.get('id');
    this.api.list().subscribe({
      next: (rows) => {
        this.reports.set(rows);
        this.loading.set(false);
        const first = wanted ?? rows.find((row) => row.status === 'SUCCEEDED')?.id ?? rows[0]?.id;
        if (first) this.open(first);
      },
      error: (error) => {
        this.loading.set(false);
        this.notifications.showHttpError(error, 'ai.manager_report.load_failed');
      },
    });
  }

  open(id: string): void {
    this.api.get(id).subscribe({
      next: (report) => {
        this.report.set(report);
        if (report.period) this.period.set(report.period);
        this.pollWhilePending(report);
      },
      error: (error) => this.notifications.showHttpError(error, 'ai.manager_report.load_failed'),
    });
  }

  write(): void {
    this.requesting.set(true);
    this.api.request(this.period()).subscribe({
      next: (report) => {
        this.requesting.set(false);
        this.report.set(report);
        this.refreshList();
        this.pollWhilePending(report);
      },
      error: (error) => {
        this.requesting.set(false);
        this.notifications.showHttpError(error, 'ai.manager_report.request_failed');
      },
    });
  }

  print(): void {
    window.print();
  }

  private refreshList(): void {
    this.api.list().subscribe({ next: (rows) => this.reports.set(rows), error: () => undefined });
  }

  private pollWhilePending(report: ManagerReport): void {
    this.polling?.unsubscribe();
    if (!pending(report.status)) return;
    this.polling = timer(POLL_MS).subscribe(() => {
      this.api.get(report.id).subscribe({
        next: (next) => {
          if (this.report()?.id !== next.id) return;
          this.report.set(next);
          if (pending(next.status)) this.pollWhilePending(next);
          else this.refreshList();
        },
        error: () => this.pollWhilePending(report),
      });
    });
  }
}
