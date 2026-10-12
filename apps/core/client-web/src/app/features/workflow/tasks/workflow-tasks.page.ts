import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { LucideAngularModule, ExternalLink } from 'lucide-angular';
import { FormatService } from '@virteex/shared/ui-i18n';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { InboxShellComponent, InboxItem, InboxSection } from '../../../shared/components/gestures';
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
  imports: [TranslateModule, LucideAngularModule, InboxShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-tasks.page.scss',
  template: `
    <vx-inbox-shell
      titleKey="workflow_engine.nav.tasks"
      [sections]="sections()"
      [loading]="loading()"
      [error]="error()"
      [itemActions]="outcomes"
      (reload)="load()"
    >
    </vx-inbox-shell>

    <!--
      The outcomes resolve the task without leaving the inbox, and they are exactly the ones its node
      declared. «View run» sits beside them rather than on the title: whoever decides often wants to
      look at the path first, but deciding should never require navigating away.
    -->
    <ng-template #outcomes let-item>
      @if (taskOf(item.id); as task) {
        <button type="button" class="wft__open" (click)="openInstance(task)">
          <lucide-icon [img]="OpenIcon" size="13" aria-hidden="true"></lucide-icon>
          <span>{{ 'workflow_engine.view_run' | translate }}</span>
        </button>
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
      }
    </ng-template>
  `,
})
export class WorkflowTasksPage implements OnInit {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);

  private readonly format = inject(FormatService);

  protected readonly OpenIcon = ExternalLink;

  readonly tasks = signal<WorkflowTask[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly acting = signal<string | null>(null);

  /**
   * One section: everything here is the same kind of thing — a human step of a running process —
   * so splitting it would invent categories. With no tasks the shell says the inbox is clear.
   *
   * The shell takes composed text, not keys or raw dates: the due date is formatted here, once, in
   * the reader's language, and a task past it is flagged so it reads as overdue, not just as red.
   */
  readonly sections = computed<InboxSection[]>(() => {
    const now = Date.now();
    return [
      {
        labelKey: 'workflow_engine.open_tasks',
        items: this.tasks().map(
          (task): InboxItem => ({
            id: task.id,
            title: task.name,
            when: task.dueAt ? this.format.date(task.dueAt) : undefined,
            overdue: task.dueAt ? new Date(task.dueAt).getTime() < now : false,
            link: null,
          }),
        ),
      },
    ];
  });

  /** The actions template receives the `InboxItem`; the outcomes live on the original task. */
  private readonly byId = computed(() => new Map(this.tasks().map((task) => [task.id, task])));

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

  taskOf(id: string): WorkflowTask | undefined {
    return this.byId().get(id);
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
