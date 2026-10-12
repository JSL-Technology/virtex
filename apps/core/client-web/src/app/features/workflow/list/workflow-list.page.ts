import { composeKey } from '@virteex/shared/types';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import {
  CopyPlus,
  Download,
  EyeOff,
  GitBranchPlus,
  History,
  LucideAngularModule,
  Pencil,
  Play,
  Plus,
  Trash2,
  Zap,
  Hand,
} from 'lucide-angular';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthService } from '../../../core/services/auth';
import { DialogService } from '../../../core/services/dialog.service';
import { NotificationService } from '../../../core/services/notification';
import { TabEvent, TabEventBusService } from '../../../core/tabs/tab-event-bus.service';
import { VX_UI } from '../../../shared/components';
import { ListShellComponent } from '../../../shared/components/gestures';
import { RowLinkDirective } from '../../../shared/directives/row-link.directive';
import { eventLabel } from '../data/workflow-labels';
import { WorkflowDefinition, WorkflowDefinitionSummary, WorkflowInstance, WorkflowService } from '../data/workflow.service';
import { StartRunDialogComponent } from '../shared/start-run-dialog.component';
import { CreateWorkflowDialogComponent } from './create-workflow-dialog.component';

type StatusFilter = 'all' | 'published' | 'draft' | 'pending' | 'inactive';
type TriggerFilter = 'all' | 'manual' | 'event';

/**
 * The process catalogue — SAP's «workflow builder» list.
 *
 * One row per process, not per version: it shows the live (published) version, the draft being
 * worked on if there is one, how many runs are in flight and what starts it. Every lifecycle move
 * lives here or in the designer: open, run, new version, duplicate, export, deactivate, delete a
 * draft. Deleting closes any designer tab still showing that draft.
 */
@Component({
  selector: 'app-workflow-list-page',
  standalone: true,
  imports: [
    TranslateModule,
    LucideAngularModule,
    RouterLink,
    RowLinkDirective,
    ...FORMAT_PIPES,
    ...VX_UI,
    ListShellComponent,
    CreateWorkflowDialogComponent,
    StartRunDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-list.page.scss',
  template: `
    <vx-list-shell
      titleKey="workflow_engine.title"
      subtitleKey="workflow_engine.list.subtitle"
      [count]="rows().length"
      [loading]="loading()"
      [error]="error()"
      [empty]="rows().length === 0"
      [searchable]="true"
      searchPlaceholderKey="workflow_engine.list.search"
      [(search)]="query"
      (reload)="load()"
    >
      @if (canDesign()) {
        <button listActions type="button" class="primary-button" (click)="creating.set(true)">
          <lucide-icon [img]="PlusIcon" [size]="16" aria-hidden="true" />
          <span>{{ 'workflow_engine.new' | translate }}</span>
        </button>
      }

      <div listFilters class="wfl__filters">
        <div class="wfl__chips" role="group" [attr.aria-label]="'workflow_engine.list.filter_status' | translate">
          @for (option of statusOptions; track option) {
            <button type="button" class="chip" [class.chip--active]="status() === option" [attr.aria-pressed]="status() === option" (click)="status.set(option)">
              {{ statusLabel(option) | translate }}
              <span class="wfl__chip-count">{{ counts()[option] }}</span>
            </button>
          }
        </div>
        <label class="wfl__select">
          <span class="sr-only">{{ 'workflow_engine.list.filter_trigger' | translate }}</span>
          <select [value]="trigger()" (change)="trigger.set($any($event.target).value)">
            <option value="all">{{ 'workflow_engine.list.trigger_all' | translate }}</option>
            <option value="manual">{{ 'workflow_engine.trigger.manual' | translate }}</option>
            <option value="event">{{ 'workflow_engine.trigger.event' | translate }}</option>
          </select>
        </label>
      </div>

      <div listEmpty class="wfl__empty">
        @if (all().length === 0) {
          <p class="ls__state-title">{{ 'workflow_engine.list.empty' | translate }}</p>
          <p class="ls__state-help">{{ 'workflow_engine.list.empty_help' | translate }}</p>
          @if (canDesign()) {
            <button type="button" class="primary-button" (click)="creating.set(true)">{{ 'workflow_engine.new' | translate }}</button>
          }
        } @else {
          <p class="ls__state-title">{{ 'workflow_engine.list.no_match' | translate }}</p>
          <button type="button" class="secondary-button" (click)="resetFilters()">{{ 'workflow_engine.list.clear_filters' | translate }}</button>
        }
      </div>

      <div class="table-container card">
        <table class="data-table wfl__table">
          <thead>
            <tr>
              <th scope="col">{{ 'workflow_engine.list.name' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.list.trigger' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.list.live_version' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.list.draft' | translate }}</th>
              <th scope="col" class="text-right">{{ 'workflow_engine.list.running' | translate }}</th>
              <th scope="col">{{ 'workflow_engine.list.updated' | translate }}</th>
              <th scope="col" class="wfl__actions-col"><span class="sr-only">{{ 'workflow_engine.list.actions' | translate }}</span></th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.key) {
              @let main = row.draft ?? row.published ?? null;
              <tr appRowLink>
                <td class="wfl__name">
                  @if (main) {
                    <a class="table-link" [routerLink]="link('workflows/' + main.id + '/edit')">{{ row.name }}</a>
                  } @else {
                    <span>{{ row.name }}</span>
                  }
                  @if (row.description) {
                    <span class="wfl__description">{{ row.description }}</span>
                  }
                </td>
                <td>
                  <span class="wfl__trigger">
                    <lucide-icon [img]="row.trigger.mode === 'event' ? EventIcon : ManualIcon" [size]="14" aria-hidden="true" />
                    {{ triggerText(row) }}
                  </span>
                </td>
                <td>
                  @if (row.published; as live) {
                    <vx-badge tone="ok">{{ 'workflow_engine.version' | translate: { version: live.version } }}</vx-badge>
                    @if (live.publishedAt) {
                      <span class="wfl__sub">{{ live.publishedAt | vxDate: 'date' }}</span>
                    }
                  } @else {
                    <vx-badge tone="neutral">{{ 'workflow_engine.list.not_live' | translate }}</vx-badge>
                  }
                </td>
                <td>
                  @if (row.draft; as draft) {
                    <a class="wfl__draft" [routerLink]="link('workflows/' + draft.id + '/edit')">
                      <vx-badge tone="draft">{{ 'workflow_engine.version' | translate: { version: draft.version } }}</vx-badge>
                    </a>
                  } @else {
                    <span class="wfl__muted">—</span>
                  }
                </td>
                <td class="text-right">
                  @if (row.runningCount) {
                    <a class="table-link" [routerLink]="link('workflow-instances')" [queryParams]="{ key: row.key, status: 'RUNNING' }">{{ row.runningCount }}</a>
                  } @else {
                    <span class="wfl__muted">0</span>
                  }
                </td>
                <td>{{ row.updatedAt | vxDate: 'datetime' }}</td>
                <td class="wfl__actions">
                  @if (row.published && row.trigger.mode === 'manual' && canRun()) {
                    <button type="button" class="wfl__icon" (click)="startRun(row.published)"
                      [attr.aria-label]="'workflow_engine.list.run_named' | translate: { name: row.name }" [title]="'workflow_engine.start.confirm' | translate">
                      <lucide-icon [img]="RunIcon" [size]="16" />
                    </button>
                  }
                  @if (canDesign()) {
                    @if (row.draft) {
                      <a class="wfl__icon" [routerLink]="link('workflows/' + row.draft.id + '/edit')"
                        [attr.aria-label]="'workflow_engine.list.edit_named' | translate: { name: row.name }" [title]="'workflow_engine.edit' | translate">
                        <lucide-icon [img]="EditIcon" [size]="16" />
                      </a>
                    } @else if (row.published) {
                      <button type="button" class="wfl__icon" (click)="newVersion(row.published)"
                        [attr.aria-label]="'workflow_engine.list.version_named' | translate: { name: row.name }" [title]="'workflow_engine.new_version' | translate">
                        <lucide-icon [img]="VersionIcon" [size]="16" />
                      </button>
                    }
                    @if (main) {
                      <button type="button" class="wfl__icon" (click)="duplicate(main)"
                        [attr.aria-label]="'workflow_engine.list.duplicate_named' | translate: { name: row.name }" [title]="'workflow_engine.list.duplicate' | translate">
                        <lucide-icon [img]="DuplicateIcon" [size]="16" />
                      </button>
                    }
                  }
                  @if (main) {
                    <button type="button" class="wfl__icon" (click)="export(main)"
                      [attr.aria-label]="'workflow_engine.list.export_named' | translate: { name: row.name }" [title]="'workflow_engine.designer.export' | translate">
                      <lucide-icon [img]="ExportIcon" [size]="16" />
                    </button>
                  }
                  <a class="wfl__icon" [routerLink]="link('workflow-instances')" [queryParams]="{ key: row.key }"
                    [attr.aria-label]="'workflow_engine.list.runs_named' | translate: { name: row.name }" [title]="'workflow_engine.runs' | translate">
                    <lucide-icon [img]="RunsIcon" [size]="16" />
                  </a>
                  @if (canDesign()) {
                    @if (row.published) {
                      <button type="button" class="wfl__icon" (click)="unpublish(row.published)"
                        [attr.aria-label]="'workflow_engine.list.unpublish_named' | translate: { name: row.name }" [title]="'workflow_engine.unpublish.action' | translate">
                        <lucide-icon [img]="UnpublishIcon" [size]="16" />
                      </button>
                    }
                    @if (row.draft) {
                      <button type="button" class="wfl__icon wfl__icon--danger" (click)="remove(row.draft, row)"
                        [attr.aria-label]="'workflow_engine.list.delete_named' | translate: { name: row.name }" [title]="'workflow_engine.list.delete_draft' | translate">
                        <lucide-icon [img]="DeleteIcon" [size]="16" />
                      </button>
                    }
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </vx-list-shell>

    @if (creating()) {
      <app-create-workflow-dialog (created)="onCreated($event)" (dismissed)="creating.set(false)" />
    }
    @if (starting(); as definition) {
      <app-workflow-start-run-dialog [definition]="definition" (started)="onStarted($event)" (dismissed)="starting.set(null)" />
    }
  `,
})
export class WorkflowListPage {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly bus = inject(TabEventBusService);

  protected readonly PlusIcon = Plus;
  protected readonly EditIcon = Pencil;
  protected readonly VersionIcon = GitBranchPlus;
  protected readonly DuplicateIcon = CopyPlus;
  protected readonly ExportIcon = Download;
  protected readonly RunsIcon = History;
  protected readonly RunIcon = Play;
  protected readonly UnpublishIcon = EyeOff;
  protected readonly DeleteIcon = Trash2;
  protected readonly EventIcon = Zap;
  protected readonly ManualIcon = Hand;

  protected readonly statusOptions: StatusFilter[] = ['all', 'published', 'draft', 'pending', 'inactive'];

  readonly all = signal<WorkflowDefinitionSummary[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly query = signal('');
  readonly status = signal<StatusFilter>('all');
  readonly trigger = signal<TriggerFilter>('all');
  readonly creating = signal(false);
  readonly starting = signal<WorkflowDefinition | null>(null);

  readonly canDesign = computed(() => this.auth.hasPermissions(['workflow_engine:design']));
  readonly canRun = computed(() => this.auth.hasPermissions(['workflow_engine:run']));

  readonly counts = computed(() => {
    const list = this.all();
    return {
      all: list.length,
      published: list.filter((r) => r.published).length,
      draft: list.filter((r) => !r.published && r.draft).length,
      pending: list.filter((r) => r.published && r.draft).length,
      inactive: list.filter((r) => !r.published && !r.draft).length,
    } satisfies Record<StatusFilter, number>;
  });

  readonly rows = computed(() => {
    const q = normalize(this.query());
    const status = this.status();
    const trigger = this.trigger();
    return this.all().filter((row) => {
      if (status === 'published' && !row.published) return false;
      if (status === 'draft' && (row.published || !row.draft)) return false;
      if (status === 'pending' && !(row.published && row.draft)) return false;
      if (status === 'inactive' && (row.published || row.draft)) return false;
      if (trigger !== 'all' && row.trigger.mode !== trigger) return false;
      if (q && !normalize(`${row.name} ${row.description ?? ''} ${row.key} ${this.triggerText(row)}`).includes(q)) return false;
      return true;
    });
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.catalogue().subscribe({
      next: (list) => {
        this.all.set(list);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  link(path: string): string {
    return this.tenancy.urlFor(path);
  }

  triggerText(row: WorkflowDefinitionSummary): string {
    return row.trigger.mode === 'event' && row.trigger.event
      ? eventLabel(this.translate, row.trigger.event)
      : this.translate.instant('workflow_engine.trigger.manual');
  }

  statusLabel(option: StatusFilter): string {
    return composeKey('workflow_engine.list.status', option);
  }

  resetFilters(): void {
    this.query.set('');
    this.status.set('all');
    this.trigger.set('all');
  }

  onCreated(definition: WorkflowDefinition): void {
    this.creating.set(false);
    this.notifications.showSuccess('workflow_engine.created');
    void this.router.navigateByUrl(this.link(`workflows/${definition.id}/edit`));
  }

  startRun(definition: WorkflowDefinition): void {
    this.starting.set(definition);
  }

  onStarted(instance: WorkflowInstance): void {
    this.starting.set(null);
    this.load();
    void this.router.navigateByUrl(this.link(`workflow-instances/${instance.id}`));
  }

  newVersion(definition: WorkflowDefinition): void {
    this.service.newVersion(definition.id).subscribe({
      next: (draft) => void this.router.navigateByUrl(this.link(`workflows/${draft.id}/edit`)),
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  async duplicate(definition: WorkflowDefinition): Promise<void> {
    const name = await this.dialog.prompt({
      title: 'workflow_engine.duplicate.title',
      message: 'workflow_engine.duplicate.message',
      messageParams: { name: definition.name },
      placeholder: 'workflow_engine.field.name',
      confirmText: 'workflow_engine.duplicate.confirm',
      minLength: 1,
    });
    if (!name?.trim()) return;
    this.service.duplicate(definition.id, name.trim()).subscribe({
      next: (copy) => {
        this.notifications.showSuccess('workflow_engine.duplicate.done', { name: copy.name });
        void this.router.navigateByUrl(this.link(`workflows/${copy.id}/edit`));
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  export(definition: WorkflowDefinition): void {
    this.service.getDefinition(definition.id).subscribe({
      next: (full) => {
        const payload = {
          kind: 'virtex.workflow',
          version: 1,
          exportedAt: new Date().toISOString(),
          key: full.key,
          name: full.name,
          description: full.description,
          trigger: full.trigger,
          graph: full.graph,
        };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${full.key}-v${full.version}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.load_failed'),
    });
  }

  async unpublish(definition: WorkflowDefinition): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'workflow_engine.unpublish.title',
      message: 'workflow_engine.unpublish.message',
      messageParams: { name: definition.name },
      confirmText: 'workflow_engine.unpublish.confirm',
      variant: 'warning',
    });
    if (!confirmed) return;
    this.service.unpublish(definition.id).subscribe({
      next: () => {
        this.notifications.showSuccess('workflow_engine.unpublished');
        this.load();
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  async remove(draft: WorkflowDefinition, row: WorkflowDefinitionSummary): Promise<void> {
    const confirmed = await this.dialog.confirm({
      title: 'workflow_engine.delete_confirm.title',
      message: row.published ? 'workflow_engine.delete_confirm.message_draft' : 'workflow_engine.delete_confirm.message',
      messageParams: { name: row.name, version: draft.version },
      confirmText: 'workflow_engine.delete_confirm.confirm',
      variant: 'danger',
    });
    if (!confirmed) return;
    this.service.deleteDefinition(draft.id).subscribe({
      next: () => {
        this.notifications.showSuccess('workflow_engine.deleted');
        // Close a designer tab still showing the deleted draft.
        this.bus.emit({ type: TabEvent.RECORD_DELETED, entity: 'workspace:workflow', id: draft.id });
        this.load();
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.delete_failed'),
    });
  }
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
