import { ChangeDetectionStrategy, ChangeDetectorRef, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES, FormatService } from '@virteex/shared/ui-i18n';
import { ExternalLink, LucideAngularModule, MessageSquareText } from 'lucide-angular';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { AuthService } from '../../../core/services/auth';
import { TAB_CONTEXT } from '../../../core/tabs/tab-context';
import { VX_UI } from '../../../shared/components';
import { InboxItem, InboxSection, InboxShellComponent } from '../../../shared/components/gestures';
import { outcomeLabel, outcomeTone } from '../data/workflow-labels';
import { WorkflowService, WorkflowTask } from '../data/workflow.service';
import { WorkflowFieldsComponent, fieldProblems } from '../shared/workflow-fields.component';

const DUE_SOON_MS = 24 * 60 * 60 * 1000;
const REFRESH_MS = 60000;

/**
 * «My workflow tasks» — the approver's inbox.
 *
 * What waits on the reader, by urgency: overdue first, then what falls due within a day, then the
 * rest. A task that needs nothing but a decision can be answered from the row; one that asks for
 * data, a comment or a careful read opens a dialog with everything the decision needs — the
 * document it is about, the process facts, the instructions, the form. Buttons are single-flight,
 * so a double click answers once. `?task=<id>` (the link in the notification) opens that task
 * directly. «Done» lists what the reader answered recently.
 */
@Component({
  selector: 'app-workflow-tasks-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, RouterLink, ...FORMAT_PIPES, ...VX_UI, InboxShellComponent, WorkflowFieldsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-tasks.page.scss',
  template: `
    <vx-inbox-shell
      titleKey="workflow_engine.nav.tasks"
      [subtitleKey]="view() === 'open' ? 'workflow_engine.inbox.subtitle_open' : 'workflow_engine.inbox.subtitle_done'"
      [sections]="sections()"
      [loading]="loading()"
      [error]="error()"
      [itemActions]="actions"
      (reload)="load()"
    >
      <div inboxActions class="wft__views" role="group" [attr.aria-label]="'workflow_engine.inbox.view' | translate">
        <button type="button" class="chip" [class.chip--active]="view() === 'open'" [attr.aria-pressed]="view() === 'open'" (click)="setView('open')">
          {{ 'workflow_engine.inbox.pending' | translate }}
        </button>
        <button type="button" class="chip" [class.chip--active]="view() === 'done'" [attr.aria-pressed]="view() === 'done'" (click)="setView('done')">
          {{ 'workflow_engine.inbox.done' | translate }}
        </button>
      </div>
    </vx-inbox-shell>

    <ng-template #actions let-item>
      @if (taskOf(item.id); as task) {
        @if (task.status === 'OPEN') {
          @if (quickDecision(task)) {
            @for (outcome of task.outcomes; track outcome) {
              <button type="button" class="wft__outcome" [class]="'wft__outcome wft__outcome--' + tone(outcome)" [disabled]="pending().has(task.id)" (click)="complete(task, outcome)">
                {{ label(task, outcome) }}
              </button>
            }
          }
          <button type="button" class="secondary-button wft__open" [disabled]="pending().has(task.id)" (click)="open(task)">
            <lucide-icon [img]="DetailIcon" [size]="14" aria-hidden="true" />
            {{ (quickDecision(task) ? 'workflow_engine.inbox.details' : 'workflow_engine.inbox.respond') | translate }}
          </button>
        } @else {
          <button type="button" class="secondary-button wft__open" (click)="open(task)">{{ 'workflow_engine.inbox.details' | translate }}</button>
        }
        <a class="wft__link" [routerLink]="link('workflow-instances/' + task.instanceId)" [title]="'workflow_engine.inbox.view_run' | translate"
          [attr.aria-label]="'workflow_engine.inbox.view_run' | translate">
          <lucide-icon [img]="OpenIcon" [size]="14" />
        </a>
      }
    </ng-template>

    @if (active(); as task) {
      <vx-dialog [title]="task.name" size="lg" [busy]="pending().has(task.id)" (dismissed)="close()">
        <div class="wft-detail">
          <div class="wft-detail__meta">
            <span>{{ task.definitionName }} · {{ 'workflow_engine.version' | translate: { version: task.definitionVersion } }}</span>
            @if (task.subject?.label) {
              <span>
                @if (task.subject?.route) {
                  <a [href]="link(task.subject!.route!)" (click)="$event.preventDefault(); leaveTo(task.subject!.route!)">{{ task.subject?.label }} <lucide-icon [img]="OpenIcon" [size]="12" aria-hidden="true" /></a>
                } @else {
                  {{ task.subject?.label }}
                }
              </span>
            }
            @if (task.startedByName) {
              <span>{{ 'workflow_engine.inbox.started_by' | translate: { name: task.startedByName } }}</span>
            }
            @if (task.dueAt) {
              <span [class.wft-detail__overdue]="task.overdue">{{ 'workflow_engine.instance.due' | translate: { date: (task.dueAt | vxDate: 'dateTime') } }}</span>
            }
          </div>

          @if (task.instructions) {
            <section class="wft-detail__section">
              <h3>{{ 'workflow_engine.field.instructions' | translate }}</h3>
              <p class="wft-detail__instructions">{{ task.instructions }}</p>
            </section>
          }

          @if (task.facts?.length) {
            <section class="wft-detail__section">
              <h3>{{ 'workflow_engine.inbox.facts' | translate }}</h3>
              <dl class="wft-detail__facts">
                @for (fact of task.facts; track fact.name) {
                  <div><dt>{{ fact.label || fact.name }}</dt><dd>{{ factValue(fact.value) }}</dd></div>
                }
              </dl>
            </section>
          }

          @if (task.status === 'OPEN') {
            @if (task.form?.length) {
              <section class="wft-detail__section">
                <h3>{{ 'workflow_engine.inbox.form' | translate }}</h3>
                <app-workflow-fields [fields]="task.form!" [value]="formData()" [submitted]="submitted()" idPrefix="wft-form"
                  [relaxRequired]="refusing(task)" (valueChange)="formData.set($event)" />
              </section>
            }
            <section class="wft-detail__section">
              <label for="wft-comment" class="wft-detail__label">
                {{ 'workflow_engine.inbox.comment' | translate }}
                @if (commentRequired(task)) {
                  <span aria-hidden="true">*</span>
                }
              </label>
              <textarea id="wft-comment" rows="3" maxlength="2000" [value]="comment()" (input)="comment.set($any($event.target).value)"
                [attr.aria-invalid]="commentMissing() || null" [attr.aria-describedby]="commentMissing() ? 'wft-comment-err' : 'wft-comment-hint'"></textarea>
              @if (commentMissing()) {
                <p class="wft-detail__error" id="wft-comment-err" role="alert">{{ 'workflow_engine.inbox.comment_required' | translate: { outcome: label(task, chosen()!) } }}</p>
              } @else if ((task.commentRequiredFor ?? []).length) {
                <p class="wft-detail__hint" id="wft-comment-hint">
                  {{ 'workflow_engine.inbox.comment_required_for' | translate: { outcomes: requiredFor(task) } }}
                </p>
              }
            </section>
          } @else if (task.status === 'CANCELLED') {
            <!-- A cancelled task was never answered: saying «your answer» with nothing after it read as
                 if the person had responded (QA A-10). -->
            <section class="wft-detail__section" role="status">
              <h3>{{ 'workflow_engine.inbox.cancelled_title' | translate }}</h3>
              <p>{{ 'workflow_engine.inbox.cancelled_body' | translate: { date: (task.completedAt | vxDate: 'dateTime') } }}</p>
            </section>
          } @else {
            <section class="wft-detail__section">
              <h3>{{ (task.completedByName && task.completedByUserId !== myId() ? 'workflow_engine.inbox.answer_by' : 'workflow_engine.inbox.your_answer') | translate: { name: task.completedByName } }}</h3>
              <p>{{ label(task, task.outcome ?? '') }} · {{ task.completedAt | vxDate: 'dateTime' }}</p>
              @if (task.comment) {
                <q class="wft-detail__instructions">{{ task.comment }}</q>
              }
            </section>
          }
        </div>
        <div dialogActions class="wft-detail__actions">
          <button type="button" class="secondary-button" (click)="leaveTo('workflow-instances/' + task.instanceId)">{{ 'workflow_engine.inbox.view_run' | translate }}</button>
          @if (task.status === 'OPEN') {
            @for (outcome of task.outcomes; track outcome) {
              <button type="button" [class]="tone(outcome) === 'danger' ? 'secondary-button wft__danger' : tone(outcome) === 'primary' ? 'primary-button' : 'secondary-button'"
                [disabled]="pending().has(task.id)" (click)="submit(task, outcome)">
                {{ label(task, outcome) }}
              </button>
            }
          }
        </div>
      </vx-dialog>
    }
  `,
})
export class WorkflowTasksPage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly notifications = inject(NotificationService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly router = inject(Router);
  private readonly tab = inject(TAB_CONTEXT, { optional: true });
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly auth = inject(AuthService);

  /** `?task=<id>` from a notification or a run's «open task» link. */
  readonly task = input<string>('');

  readonly view = signal<'open' | 'done'>('open');
  readonly tasks = signal<WorkflowTask[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly pending = signal<Set<string>>(new Set());
  readonly active = signal<WorkflowTask | null>(null);
  readonly formData = signal<Record<string, unknown>>({});
  readonly comment = signal('');
  readonly chosen = signal<string | null>(null);
  readonly submitted = signal(false);

  protected readonly DetailIcon = MessageSquareText;
  protected readonly OpenIcon = ExternalLink;

  private readonly byId = computed(() => new Map(this.tasks().map((t) => [t.id, t])));

  readonly sections = computed<InboxSection[]>(() => {
    const tasks = this.tasks();
    if (this.view() === 'done') {
      return [{ labelKey: 'workflow_engine.inbox.section_done', items: tasks.map((t) => this.item(t)) }];
    }
    const now = Date.now();
    const overdue = tasks.filter((t) => t.overdue);
    const soon = tasks.filter((t) => !t.overdue && t.dueAt && new Date(t.dueAt).getTime() - now <= DUE_SOON_MS);
    const later = tasks.filter((t) => !overdue.includes(t) && !soon.includes(t));
    const sections: InboxSection[] = [];
    if (overdue.length) sections.push({ labelKey: 'workflow_engine.inbox.section_overdue', items: overdue.map((t) => this.item(t)) });
    sections.push({ labelKey: 'workflow_engine.inbox.section_soon', items: soon.map((t) => this.item(t)) });
    sections.push({ labelKey: 'workflow_engine.inbox.section_later', items: later.map((t) => this.item(t)) });
    return sections;
  });

  readonly commentMissing = computed(() => {
    const task = this.active();
    const outcome = this.chosen();
    return !!task && !!outcome && this.submitted() && (task.commentRequiredFor ?? []).includes(outcome) && !this.comment().trim();
  });

  private deepLinkHandled = '';

  constructor() {
    this.load();

    effect(() => {
      const id = this.task() || this.tab?.query?.['task'] || '';
      if (id && id !== this.deepLinkHandled) untracked(() => this.openById(id));
    });

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !this.active() && this.view() === 'open') this.load(true);
    }, REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  load(quiet = false): void {
    if (!quiet) {
      this.loading.set(true);
      this.error.set(null);
    }
    this.service.myTasks(this.view()).subscribe({
      next: (tasks) => {
        this.tasks.set(tasks);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (!quiet) this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  setView(view: 'open' | 'done'): void {
    if (this.view() === view) return;
    this.view.set(view);
    this.load();
  }

  link(path: string): string {
    return this.tenancy.urlFor(path);
  }

  taskOf(id: string): WorkflowTask | undefined {
    return this.byId().get(id);
  }

  /** Answerable from the row: no form to fill and no comment demanded by any outcome. */
  quickDecision(task: WorkflowTask): boolean {
    return !task.form?.length && !(task.commentRequiredFor ?? []).length && !task.instructions;
  }

  commentRequired(task: WorkflowTask): boolean {
    const outcome = this.chosen();
    return !!outcome && (task.commentRequiredFor ?? []).includes(outcome);
  }

  requiredFor(task: WorkflowTask): string {
    return (task.commentRequiredFor ?? []).map((o) => this.label(task, o)).join(', ');
  }

  label(task: WorkflowTask, outcome: string): string {
    return outcomeLabel(this.translate, outcome, task.outcomeLabels);
  }

  tone(outcome: string) {
    return outcomeTone(outcome);
  }

  /** A fact as the run view shows it: the person's number and date format, yes/no in words. */
  factValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return this.translate.instant(value ? 'workflow_engine.yes' : 'workflow_engine.no');
    if (typeof value === 'number') return this.format.number(value);
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/.test(value) && !Number.isNaN(Date.parse(value))) {
      return this.format.date(value, value.length > 10 ? 'dateTime' : 'date');
    }
    if (Array.isArray(value)) return value.map((item) => this.factValue(item)).join(', ');
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  open(task: WorkflowTask): void {
    this.active.set(task);
    this.formData.set({ ...(task.formData ?? {}) });
    this.comment.set('');
    this.chosen.set(null);
    this.submitted.set(false);
  }

  close(): void {
    this.active.set(null);
    // Drop `?task=` so a reload doesn't reopen what was just closed.
    if (this.task() || this.tab?.query?.['task']) {
      void this.router.navigate([], { queryParams: { task: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  private openById(id: string): void {
    this.deepLinkHandled = id;
    const known = this.byId().get(id);
    if (known) return this.open(known);
    this.service.getTask(id).subscribe({
      next: (task) => this.open(task),
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.inbox.task_unavailable'),
    });
  }

  /** From the row: a plain decision. */
  complete(task: WorkflowTask, outcome: string): void {
    this.send(task, { outcome });
  }

  /** The chosen answer is a refusal: it asks for a reason and waives the form's required fields. */
  refusing(task: WorkflowTask): boolean {
    const outcome = this.chosen();
    return !!outcome && (task.commentRequiredFor ?? []).includes(outcome);
  }

  /**
   * Leave the dialog for another page. The dialog is closed and rendered closed first: the page we
   * go to opens in another tab, and this one stops rendering the moment it is hidden (QA C-03).
   */
  leaveTo(path: string): void {
    this.close();
    this.cdr.detectChanges();
    setTimeout(() => void this.router.navigateByUrl(this.link(path)));
  }

  myId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  /** From the dialog: checks the form and the comment first. */
  submit(task: WorkflowTask, outcome: string): void {
    this.chosen.set(outcome);
    this.submitted.set(true);
    if (task.form?.length && Object.keys(fieldProblems(task.form, this.formData(), { relaxRequired: this.refusing(task) })).length) return;
    if ((task.commentRequiredFor ?? []).includes(outcome) && !this.comment().trim()) return;
    this.send(task, { outcome, formData: task.form?.length ? this.formData() : undefined, comment: this.comment().trim() || undefined });
  }

  private send(task: WorkflowTask, body: { outcome: string; formData?: Record<string, unknown>; comment?: string }): void {
    if (this.pending().has(task.id)) return;
    this.pending.update((set) => new Set(set).add(task.id));
    this.service.completeTask(task.id, body).subscribe({
      next: () => {
        this.done(task.id);
        this.notifications.showSuccess('workflow_engine.task_completed', { outcome: this.label(task, body.outcome) });
        if (this.active()?.id === task.id) this.close();
        this.tasks.update((list) => list.filter((t) => t.id !== task.id));
      },
      error: (err: unknown) => {
        this.done(task.id);
        this.notifications.showHttpError(err, 'workflow_engine.task_failed');
        // Already answered elsewhere, or reassigned: the list is stale.
        this.load(true);
      },
    });
  }

  private done(id: string): void {
    this.pending.update((set) => {
      const next = new Set(set);
      next.delete(id);
      return next;
    });
  }

  private item(task: WorkflowTask): InboxItem {
    const subject = task.subject?.label;
    const parts = [subject, task.definitionName, task.startedByName ? this.translate.instant('workflow_engine.inbox.started_by', { name: task.startedByName }) : null];
    if (this.view() === 'done') {
      return {
        id: task.id,
        title: task.name,
        detail: [this.label(task, task.outcome ?? ''), task.comment ? `«${task.comment}»` : null, task.definitionName].filter(Boolean).join(' · '),
        when: task.completedAt ? new Date(task.completedAt).toLocaleString(this.translate.currentLang) : undefined,
        link: null,
      };
    }
    return {
      id: task.id,
      title: task.name,
      detail: parts.filter(Boolean).join(' · '),
      when: task.dueAt ? this.dueText(task) : undefined,
      overdue: !!task.overdue,
      link: null,
    };
  }

  private dueText(task: WorkflowTask): string {
    const due = new Date(task.dueAt as string).getTime();
    const diff = due - Date.now();
    const hours = Math.round(Math.abs(diff) / 3600000);
    const amount = hours >= 48 ? this.translate.instant('workflow_engine.unit.days_short', { count: Math.round(hours / 24) }) : this.translate.instant('workflow_engine.unit.hours_short', { count: Math.max(1, hours) });
    return this.translate.instant(diff < 0 ? 'workflow_engine.inbox.overdue_by' : 'workflow_engine.inbox.due_in', { amount });
  }
}
