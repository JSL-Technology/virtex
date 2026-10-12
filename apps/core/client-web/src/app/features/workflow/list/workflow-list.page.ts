import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { LucideAngularModule, CopyPlus, Pencil, Plus, Send, Trash2, Workflow } from 'lucide-angular';
import { FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { NotificationService } from '../../../core/services/notification';
import { DialogService } from '../../../core/services/dialog.service';
import { WorkflowDefinition, WorkflowService } from '../data/workflow.service';

/**
 * The workflow catalogue: every process the tenant has designed, and the way into the designer.
 *
 * A definition is editable only while it is a draft; once published it is versioned, so the actions
 * a row offers follow its status — a draft can be edited, published or deleted, a published one can
 * be revised (which opens a fresh draft version) or run. The list is the one place those lifecycle
 * moves live, so the designer itself only ever edits a single draft.
 */
@Component({
  selector: 'app-workflow-list-page',
  standalone: true,
  imports: [TranslateModule, LucideAngularModule, ...FORMAT_PIPES],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workflow-list.page.scss',
  template: `
    <div class="wfl">
      <header class="wfl__header">
        <div class="wfl__title">
          <lucide-icon [img]="WorkflowIcon" [size]="18" />
          <h1>{{ 'workflow_engine.title' | translate }}</h1>
        </div>
        <button type="button" class="wfl__new" (click)="create()">
          <lucide-icon [img]="PlusIcon" [size]="16" />
          {{ 'workflow_engine.new' | translate }}
        </button>
      </header>

      @if (loading()) {
        <div class="wfl__state">{{ 'workflow_engine.loading' | translate }}</div>
      } @else if (error()) {
        <div class="wfl__state wfl__state--error">{{ error() }}</div>
      } @else if (definitions().length === 0) {
        <div class="wfl__state">{{ 'workflow_engine.list.empty' | translate }}</div>
      } @else {
        <table class="wfl__table">
          <thead>
            <tr>
              <th>{{ 'workflow_engine.list.name' | translate }}</th>
              <th>{{ 'workflow_engine.list.version' | translate }}</th>
              <th>{{ 'workflow_engine.list.status' | translate }}</th>
              <th>{{ 'workflow_engine.list.updated' | translate }}</th>
              <th class="wfl__actions-col"></th>
            </tr>
          </thead>
          <tbody>
            @for (definition of definitions(); track definition.id) {
              <tr>
                <td class="wfl__name">
                  <button type="button" class="wfl__link" (click)="openDesigner(definition)">
                    {{ definition.name }}
                  </button>
                  @if (definition.trigger.mode === 'event' && definition.trigger.event) {
                    <span class="wfl__trigger">{{ definition.trigger.event }}</span>
                  }
                </td>
                <td>v{{ definition.version }}</td>
                <td>
                  <span class="wfl__badge" [attr.data-status]="definition.status">
                    {{ 'workflow_engine.definition_status.' + definition.status.toLowerCase() | translate }}
                  </span>
                </td>
                <td>{{ definition.updatedAt | vxDate }}</td>
                <td class="wfl__actions">
                  @if (definition.status === 'DRAFT') {
                    <button type="button" (click)="openDesigner(definition)" [title]="'workflow_engine.edit' | translate">
                      <lucide-icon [img]="EditIcon" [size]="16" />
                    </button>
                    <button type="button" (click)="publish(definition)" [title]="'workflow_engine.publish' | translate">
                      <lucide-icon [img]="PublishIcon" [size]="16" />
                    </button>
                    <button type="button" (click)="remove(definition)" [title]="'workflow_engine.delete' | translate">
                      <lucide-icon [img]="DeleteIcon" [size]="16" />
                    </button>
                  } @else {
                    <button type="button" (click)="openDesigner(definition)" [title]="'workflow_engine.view' | translate">
                      <lucide-icon [img]="EditIcon" [size]="16" />
                    </button>
                    <button type="button" (click)="newVersion(definition)" [title]="'workflow_engine.new_version' | translate">
                      <lucide-icon [img]="VersionIcon" [size]="16" />
                    </button>
                  }
                  <button type="button" (click)="openRuns(definition)" [title]="'workflow_engine.runs' | translate">
                    <lucide-icon [img]="WorkflowIcon" [size]="16" />
                  </button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      }
    </div>
  `,
})
export class WorkflowListPage implements OnInit {
  private readonly service = inject(WorkflowService);
  private readonly tenancy = inject(ActiveOrganizationService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);
  private readonly dialog = inject(DialogService);

  protected readonly WorkflowIcon = Workflow;
  protected readonly PlusIcon = Plus;
  protected readonly EditIcon = Pencil;
  protected readonly PublishIcon = Send;
  protected readonly VersionIcon = CopyPlus;
  protected readonly DeleteIcon = Trash2;

  readonly definitions = signal<WorkflowDefinition[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.service.listDefinitions().subscribe({
      next: (definitions) => {
        this.definitions.set(definitions);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.error.set(this.notifications.httpErrorMessage(err, 'workflow_engine.load_failed'));
        this.loading.set(false);
      },
    });
  }

  async create(): Promise<void> {
    const name = await this.dialog.prompt({
      title: 'workflow_engine.create_title',
      message: 'workflow_engine.create_message',
      confirmText: 'workflow_engine.new',
      minLength: 1,
    });
    if (!name) return;
    this.service.createDefinition({ name }).subscribe({
      next: (created) => this.openDesigner(created),
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  openDesigner(definition: WorkflowDefinition): void {
    void this.router.navigateByUrl(this.tenancy.urlFor(`workflows/${definition.id}/edit`));
  }

  openRuns(definition: WorkflowDefinition): void {
    void this.router.navigateByUrl(
      `${this.tenancy.urlFor('workflow-instances')}?definitionId=${definition.id}`,
    );
  }

  publish(definition: WorkflowDefinition): void {
    this.service.publish(definition.id).subscribe({
      next: () => {
        this.notifications.showSuccess('workflow_engine.published');
        this.load();
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.publish_failed'),
    });
  }

  newVersion(definition: WorkflowDefinition): void {
    this.service.newVersion(definition.id).subscribe({
      next: (draft) => this.openDesigner(draft),
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.save_failed'),
    });
  }

  async remove(definition: WorkflowDefinition): Promise<void> {
    const ok = await this.dialog.confirm({
      title: 'workflow_engine.delete_title',
      message: 'workflow_engine.delete_message',
      messageParams: { name: definition.name },
      confirmText: 'workflow_engine.delete',
      variant: 'danger',
    });
    if (!ok) return;
    this.service.deleteDefinition(definition.id).subscribe({
      next: () => {
        this.notifications.showSuccess('workflow_engine.deleted');
        this.load();
      },
      error: (err: unknown) => this.notifications.showHttpError(err, 'workflow_engine.delete_failed'),
    });
  }
}
