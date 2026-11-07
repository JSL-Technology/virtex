import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { composeKey } from '@virteex/shared/types';
import { Bot, LucideAngularModule, MessageSquare, ThumbsUp } from 'lucide-angular';
import { NotificationService } from '../../../core/services/notification';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { VxBadgeComponent, type VxTone } from '../../../shared/components/badge';
import { VxEmptyStateComponent, VxErrorStateComponent, VxSpinnerComponent } from '../../../shared/components/feedback';
import { AiOverview, AiRunSummary, AiService } from '../data/ai.service';
import { AgentRun, AgentsApiService, CopilotFeedbackReport, CopilotProposalEntry } from '../agents/agents.service';

type RunKind = 'forecast' | 'anomaly';

/**
 * Analysis › AI activity: what the AI did, not what it is allowed to do.
 *
 * The engine's scheduled runs with their measured accuracy and a button to run them now, what is
 * waiting for a person, the agents' log with what each run proposed, the assistant's drafts and
 * what became of them, and how people rated its answers. All of it used to sit inside Settings ›
 * Artificial intelligence, under the policy, where it made the page three screens long and mixed
 * operation with configuration (ARQ-01). Settings now links here.
 */
@Component({
  selector: 'app-ai-activity-page',
  standalone: true,
  imports: [
    RouterLink,
    TranslateModule,
    LucideAngularModule,
    HasPermissionDirective,
    VxBadgeComponent,
    VxEmptyStateComponent,
    VxErrorStateComponent,
    VxSpinnerComponent,
    ...FORMAT_PIPES,
  ],
  templateUrl: './ai-activity.page.html',
  styleUrl: './ai-activity.page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiActivityPage implements OnInit {
  private readonly ai = inject(AiService);
  private readonly agents = inject(AgentsApiService);
  private readonly notifications = inject(NotificationService);
  private readonly organization = inject(ActiveOrganizationService);

  protected readonly k = composeKey;
  protected readonly runKinds = ['forecast', 'anomaly'] as const;
  protected readonly BotIcon = Bot;
  protected readonly ChatIcon = MessageSquare;
  protected readonly RatingIcon = ThumbsUp;

  readonly overview = signal<AiOverview | null>(null);
  readonly overviewState = signal<'loading' | 'error' | 'ready'>('loading');
  readonly starting = signal<RunKind | null>(null);

  readonly runs = signal<AgentRun[]>([]);
  readonly proposals = signal<CopilotProposalEntry[]>([]);
  readonly feedback = signal<CopilotFeedbackReport | null>(null);
  readonly logState = signal<'loading' | 'error' | 'ready'>('loading');
  readonly runningAgent = signal(false);

  protected readonly predictionsLink = computed(() => this.organization.urlFor('/inventory/predictions'));
  protected readonly anomaliesLink = computed(() => this.organization.urlFor('/reports/anomalies'));

  ngOnInit(): void {
    this.loadOverview();
    this.loadLog();
  }

  loadOverview(): void {
    this.overviewState.set('loading');
    this.ai.overview().subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.overviewState.set('ready');
      },
      error: () => this.overviewState.set('error'),
    });
  }

  loadLog(): void {
    this.logState.set('loading');
    let pending = 3;
    let failed = false;
    const done = (ok: boolean) => {
      failed ||= !ok;
      if (--pending === 0) this.logState.set(failed ? 'error' : 'ready');
    };
    this.agents.runs().subscribe({ next: (runs) => (this.runs.set(runs), done(true)), error: () => done(false) });
    this.agents.copilotProposals().subscribe({ next: (rows) => (this.proposals.set(rows), done(true)), error: () => done(false) });
    this.agents.copilotFeedback().subscribe({ next: (report) => (this.feedback.set(report), done(true)), error: () => done(false) });
  }

  run(kind: RunKind): void {
    this.starting.set(kind);
    const request = kind === 'forecast' ? this.ai.runForecast() : this.ai.runAnomalies();
    request.subscribe({
      next: () => {
        this.starting.set(null);
        this.notifications.showSuccess('ai.admin.run_queued');
        this.loadOverview();
      },
      error: (err) => {
        this.starting.set(null);
        this.notifications.showHttpError(err, 'ai.admin.run_failed');
      },
    });
  }

  runAgent(): void {
    this.runningAgent.set(true);
    this.agents.runReplenishment().subscribe({
      next: (result) => {
        this.runningAgent.set(false);
        this.notifications.showSuccess('ai.agents.replenishment.ran', { count: result.orders.length });
        this.loadLog();
      },
      error: (error) => {
        this.runningAgent.set(false);
        this.notifications.showHttpError(error, 'ai.agents.replenishment.run_failed');
      },
    });
  }

  runOf(kind: RunKind): { latest: AiRunSummary | null; lastSucceeded: AiRunSummary | null } {
    return this.overview()?.runs[kind] ?? { latest: null, lastSucceeded: null };
  }

  /** Why a run failed, in words: the two ways the server gives up on a run, or what it reported. */
  failureKey(run: AiRunSummary): string {
    if (run.error?.startsWith('not_started')) return 'ai.admin.run_error.not_started';
    if (run.error?.startsWith('expired')) return 'ai.admin.run_error.expired';
    if (run.error?.startsWith('enqueue failed')) return 'ai.admin.run_error.enqueue';
    return 'ai.admin.run_error.other';
  }

  isActive(run: AiRunSummary | null): boolean {
    return run?.status === 'QUEUED' || run?.status === 'RUNNING';
  }

  runTone(status: string): VxTone {
    switch (status) {
      case 'SUCCEEDED':
        return 'ok';
      case 'FAILED':
        return 'danger';
      case 'QUEUED':
      case 'RUNNING':
        return 'info';
      default:
        return 'neutral';
    }
  }
}
