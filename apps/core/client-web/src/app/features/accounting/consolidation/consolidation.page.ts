import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, FORMAT_PIPES, VxLocalizedNamePipe, tenantToday } from '@virteex/shared/ui-i18n';
import { VX_DATE } from '../../../shared/components/date';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { ListShellComponent } from '../../../shared/components/gestures';
import { NotificationService } from '../../../core/services/notification';
import { ConsolidationApiService, ConsolidatedStatements, ConsolidationRunSummary } from './consolidation.service';

/**
 * Consolidated statements of the group (audit 2026-11-07, FINB-33): the engine existed with no
 * screen at all. Runs the consolidation for a period, shows the statement of position, the result,
 * every elimination as the entry it is, and what the run could not resolve; and lists the runs
 * kept, so a figure presented last quarter can be reopened exactly as it was computed.
 */
@Component({
  selector: 'app-consolidation-page',
  standalone: true,
  imports: [...VX_DATE, FormsModule, ...VX_FORM_A11Y, TranslateModule, ...FORMAT_PIPES, VxLocalizedNamePipe, ListShellComponent],
  templateUrl: './consolidation.page.html',
  styleUrls: ['../../../shared/styles/document-list.scss', './consolidation.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConsolidationPage implements OnInit {
  private readonly api = inject(ConsolidationApiService);
  private readonly notifications = inject(NotificationService);

  readonly from = signal(`${tenantToday().slice(0, 4)}-01-01`);
  readonly to = signal(tenantToday());
  readonly result = signal<ConsolidatedStatements | null>(null);
  readonly runs = signal<ConsolidationRunSummary[]>([]);
  readonly running = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loadRuns();
  }

  runNow(): void {
    if (this.from() > this.to()) {
      this.notifications.showError('consolidation.page.period_backwards');
      return;
    }
    this.running.set(true);
    this.error.set(null);
    this.api.run(this.to(), this.from()).subscribe({
      next: (result) => {
        this.result.set(result);
        this.running.set(false);
        this.loadRuns();
      },
      error: (err) => {
        this.running.set(false);
        this.error.set('consolidation.page.run_failed');
        this.notifications.showHttpError(err, 'consolidation.page.run_failed');
      },
    });
  }

  open(run: ConsolidationRunSummary): void {
    this.api.run$(run.id).subscribe({
      next: (stored) => this.result.set({ ...stored.result, runId: stored.id }),
      error: (err) => this.notifications.showHttpError(err, 'consolidation.page.run_failed'),
    });
  }

  side(entry: { side: 'DEBIT' | 'CREDIT' }): string {
    return entry.side === 'DEBIT' ? 'consolidation.page.debit' : 'consolidation.page.credit';
  }

  private loadRuns(): void {
    this.api.runs().subscribe({ next: (runs) => this.runs.set(runs), error: () => this.runs.set([]) });
  }
}
