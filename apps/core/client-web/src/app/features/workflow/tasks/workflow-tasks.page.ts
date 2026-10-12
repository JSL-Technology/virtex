import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, CheckSquare, Clock, ExternalLink } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { WorkflowService, WorkflowTask } from '../data/workflow.service';

/**
 * The workflow task inbox: the human steps of running processes that are waiting on this person.
 *
 * Each task offers exactly the outcomes its node declared — «approve»/«reject» on an approval, a
 * custom set on a task — and choosing one completes the task and advances the instance in a single
 * call. The list reloads afterwards, because completing a task may immediately raise the next one.
 */
@Component({
  selector: 'app-workflow-tasks-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-tasks.page.scss',
  template: `
    <div class="wft">
      <header class="wft__header">
        <lucide-icon [img]="TasksIcon" [size]="18" />
        <h1>{{ 'workflow_engine.nav.tasks' | translate }}</h1>
      </header>

      @if (loading()) {
        <div class="wft__state">{{ 'workflow_engine.loading' | translate }}</div>
      } @else if (error()) {
        <div class="wft__state wft__state--error">{{ error() }}</div>
      } @else if (tasks().length === 0) {
        <div class="wft__state">{{ 'workflow_engine.tasks_empty' | translate }}</div>
      } @else {
        <ul class="wft__list">
          @for (task of tasks(); track task.id) {
            <li class="wft__task">
              <div class="wft__task-main">
                <span class="wft__task-name">{{ task.name }}</span>
                <span class="wft__task-meta">
                  @if (task.dueAt) {
                    <span class="wft__due"><lucide-icon [img]="ClockIcon" [size]="13" /> {{ task.dueAt | vxDate }}</span>
                  }
                  <button type="button" class="wft__open" (click)="openInstance(task)">
                    <lucide-icon [img]="OpenIcon" [size]="13" />
                    {{ 'workflow_engine.view_run' | translate }}
                  </button>
                </span>
              </div>
              <div class="wft__outcomes">
                @for (outcome of task.outcomes; track outcome) {
                  <button
                    type="button"
                    class="wft__outcome"
                    [class.wft__outcome--reject]="outcome === 'reject'"
                    [class.wft__outcome--approve]="outcome === 'approve'"
                    [disabled]="acting() === task.id"
                    (click)="complete(task, outcome)"
                  >
                    {{ outcomeLabel(outcome) }}
                  </button>
                }
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class WorkflowTasksPage implements OnInit {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  protected readonly TasksIcon = CheckSquare;
  protected readonly ClockIcon = Clock;
  protected readonly OpenIcon = ExternalLink;

  readonly tasks = signal<WorkflowTask[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly acting = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.myTasks().subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  /** Known outcomes get a localized label; anything custom shows exactly as the author typed it. */
  outcomeLabel(outcome: string): string {
    const known = ['approve', 'reject', 'done'];
    return known.includes(outcome) ? this.translate.instant(`workflow_engine.outcome.${outcome}`) : outcome;
  }

  complete(task: WorkflowTask, outcome: string): void {
    this.acting.set(task.id);
    this.service.completeTask(task.id, { outcome }).subscribe({
      next: () => {
        this.notifications.showSuccess('workflow_engine.task_completed');
        this.acting.set(null);
        this.load();
      },
      error: (err: unknown) => {
        this.notifications.showHttpError(err, 'workflow_engine.task_complete_failed');
        this.acting.set(null);
      },
    });
  }

  openInstance(task: WorkflowTask): void {
    void this.router.navigateByUrl(this.tenancy.urlFor(`workflow-instances/${task.instanceId}`));
  }
}
