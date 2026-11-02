import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal } from '@angular/core';
import { AppLinkPipe } from '../../../core/tenancy/app-link.pipe';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { LucideAngularModule, CheckCircle2, Circle, Sparkles } from 'lucide-angular';
import { Subscription, timer } from 'rxjs';
import { AuthService } from '../../../core/services/auth';
import { NotificationService } from '../../../core/services/notification';
import { AiReport } from '../cashflow/cashflow.service';
import { CloseAssistantService, CloseAssistantView } from './close-assistant.service';

const POLL_MS = 4000;
const pending = (status: string | undefined | null) => status === 'QUEUED' || status === 'RUNNING';

/**
 * The close, as a plan: the period's checklist in the order to work through it, what else in the
 * period deserves a look (findings nobody reviewed, bills waiting from e-mail), and — on request —
 * the plan written out by the AI from exactly those facts.
 */
@Component({
  selector: 'app-close-assistant',
  standalone: true,
  imports: [AppLinkPipe, RouterLink, TranslatePipe, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './close-assistant.component.html',
  styleUrl: './close-assistant.component.scss',
})
export class CloseAssistantComponent {
  private readonly api = inject(CloseAssistantService);
  private readonly auth = inject(AuthService);
  private readonly notifications = inject(NotificationService);
  private readonly destroyRef = inject(DestroyRef);

  readonly periodId = input<string | null>(null);
  readonly view = signal<CloseAssistantView | null>(null);
  readonly plan = signal<AiReport | null>(null);
  readonly requesting = signal(false);
  readonly canWrite = this.auth.hasPermissions(['ai_reports:view']);
  protected readonly DoneIcon = CheckCircle2;
  protected readonly TodoIcon = Circle;
  protected readonly AiIcon = Sparkles;
  protected readonly pending = pending;
  private polling: Subscription | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.polling?.unsubscribe());
    effect(() => {
      const periodId = this.periodId();
      this.view.set(null);
      this.plan.set(null);
      this.polling?.unsubscribe();
      if (!periodId) return;
      this.api.view(periodId).subscribe({ next: (view) => this.view.set(view), error: () => this.view.set(null) });
      if (this.canWrite) {
        this.api.plan(periodId).subscribe({ next: (plan) => this.showPlan(periodId, plan), error: () => this.plan.set(null) });
      }
    });
  }

  writePlan(): void {
    const periodId = this.periodId();
    if (!periodId) return;
    this.requesting.set(true);
    this.api.requestPlan(periodId).subscribe({
      next: (plan) => {
        this.requesting.set(false);
        this.showPlan(periodId, plan);
      },
      error: (err) => {
        this.requesting.set(false);
        this.notifications.showHttpError(err, 'ai.close.plan_failed');
      },
    });
  }

  private showPlan(periodId: string, plan: AiReport | null): void {
    this.plan.set(plan);
    if (!plan || !pending(plan.status)) return;
    this.polling?.unsubscribe();
    this.polling = timer(POLL_MS).subscribe(() =>
      this.api.plan(periodId).subscribe({ next: (next) => this.showPlan(periodId, next), error: () => undefined }),
    );
  }
}
