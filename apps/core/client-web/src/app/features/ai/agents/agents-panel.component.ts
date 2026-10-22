import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { VX_FORM_A11Y } from '@virteex/shared/ui-a11y';
import { NotificationService } from '../../../core/services/notification';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { AgentRun, AgentsApiService, CopilotFeedbackReport, CopilotProposalEntry, ReplenishmentSettings } from './agents.service';

/**
 * Admin › AI › Agents: the replenishment agent's settings, a run on request, and the log of
 * what every agent did and proposed — with the copilot's drafts and what became of each.
 *
 * An agent never commits the company: it writes drafts, or sends them into the approval flow the
 * company already has. This is where an administrator turns it on, bounds it, and checks its work.
 */
@Component({
  selector: 'app-ai-agents-panel',
  standalone: true,
  imports: [FormsModule, RouterLink, TranslatePipe, HasPermissionDirective, ...FORMAT_PIPES, ...VX_FORM_A11Y],
  templateUrl: './agents-panel.component.html',
  styleUrl: './agents-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiAgentsPanelComponent implements OnInit {
  private readonly api = inject(AgentsApiService);
  private readonly notifications = inject(NotificationService);
  protected readonly k = composeKey;

  readonly settings = signal<ReplenishmentSettings | null>(null);
  readonly runs = signal<AgentRun[]>([]);
  readonly proposals = signal<CopilotProposalEntry[]>([]);
  readonly feedback = signal<CopilotFeedbackReport | null>(null);
  readonly running = signal(false);

  ngOnInit(): void {
    this.api.replenishmentSettings().subscribe({ next: (settings) => this.settings.set(settings), error: () => this.settings.set(null) });
    this.loadLog();
  }

  loadLog(): void {
    this.api.runs().subscribe({ next: (runs) => this.runs.set(runs), error: () => this.runs.set([]) });
    this.api.copilotProposals().subscribe({ next: (rows) => this.proposals.set(rows), error: () => this.proposals.set([]) });
    this.api.copilotFeedback().subscribe({ next: (report) => this.feedback.set(report), error: () => this.feedback.set(null) });
  }

  update(changes: Partial<ReplenishmentSettings>): void {
    this.api.updateReplenishment(changes).subscribe({
      next: (settings) => this.settings.set(settings),
      error: (error) => this.notifications.showHttpError(error, 'ai.agents.save_failed'),
    });
  }

  setLimit(value: string | number | null): void {
    const amount = Number(value);
    this.update({ maxOrderAmount: value === '' || value === null || !(amount > 0) ? null : amount });
  }

  runNow(): void {
    this.running.set(true);
    this.api.runReplenishment().subscribe({
      next: (result) => {
        this.running.set(false);
        this.notifications.showSuccess('ai.agents.replenishment.ran', { count: result.orders.length });
        this.loadLog();
      },
      error: (error) => {
        this.running.set(false);
        this.notifications.showHttpError(error, 'ai.agents.replenishment.run_failed');
      },
    });
  }
}
