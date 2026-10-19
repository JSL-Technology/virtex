import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { CopilotApiService, CopilotChart } from './copilot-api.service';
import { CopilotChartComponent } from './copilot-chart.component';

/**
 * The charts the person pinned from the copilot, on the home page's indicators.
 *
 * Each one is drawn again on every visit from the tool it came from, with the viewer's own
 * permissions — so it follows the business, and a permission the person lost takes its figures
 * with it. Nothing is shown when there are none, or when the plan does not include the assistant.
 */
@Component({
  selector: 'app-pinned-charts',
  standalone: true,
  imports: [TranslatePipe, CopilotChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (charts().length) {
      <section class="pc" aria-labelledby="pinned-charts-title">
        <header class="pc__header">
          <h3 id="pinned-charts-title" class="pc__title">{{ 'ai.copilot.chart.pinned_title' | translate }}</h3>
          <p class="pc__hint">{{ 'ai.copilot.chart.pinned_hint' | translate }}</p>
        </header>
        <div class="pc__grid">
          @for (chart of charts(); track chart.id) {
            <app-copilot-chart class="pc__card" [chart]="chart" [busy]="busy() === chart.id" [height]="240" (togglePin)="unpin($event)" />
          }
        </div>
      </section>
    }
  `,
  styles: [
    `
      :host { display: block; }
      .pc { margin-top: var(--space-6); }
      .pc__header { margin-bottom: var(--space-3); }
      .pc__title { margin: 0; font-size: var(--text-lg); color: var(--text-primary); }
      .pc__hint { margin: var(--space-1) 0 0; font-size: var(--text-sm); color: var(--text-secondary); }
      .pc__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); gap: var(--space-4); }
      .pc__card {
        padding: var(--space-4);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        background: var(--surface-base);
      }
    `,
  ],
})
export class PinnedChartsComponent implements OnInit {
  private readonly api = inject(CopilotApiService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);

  readonly charts = signal<CopilotChart[]>([]);
  readonly busy = signal<string | null>(null);
  private readonly allowed = computed(() => this.auth.hasPermissions(['ai_copilot:use']));

  ngOnInit(): void {
    if (!this.allowed()) return;
    // A plan without the assistant answers 403; the section simply does not appear.
    this.api.pinnedCharts().subscribe({ next: (charts) => this.charts.set(charts), error: () => this.charts.set([]) });
  }

  unpin(chart: CopilotChart): void {
    if (this.busy()) return;
    this.busy.set(chart.id);
    this.api.unpin(chart.id).subscribe({
      next: () => {
        this.charts.update((list) => list.filter((item) => item.id !== chart.id));
        this.busy.set(null);
      },
      error: (error) => {
        this.busy.set(null);
        this.notifications.showHttpError(error, 'errors.unexpected');
      },
    });
  }
}
